import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { OrganizationTier } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { apiKeyCacheId, verifyApiKey } from '../lib/api-key.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { forbidden, unauthorized } from '../lib/http.js';

export type AuthContext = {
  orgId: string;
  apiKeyId: string;
  scopes: string[];
  tier: OrganizationTier;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireScopes: (
      ...scopes: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    invalidateApiKeyCache: (apiKeyId: string) => Promise<void>;
  }
}

type CachedAuth = {
  orgId: string;
  apiKeyId: string;
  scopes: string[];
  tier: OrganizationTier;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** Short TTL limits revoked-key reuse window; revoke also deletes cache entries. */
const CACHE_TTL_SECONDS = 5;

function authCacheKey(hash: string): string {
  return `apikey:auth:${hash}`;
}

function authIdMapKey(apiKeyId: string): string {
  return `apikey:id:${apiKeyId}`;
}

const authPluginImpl: FastifyPluginAsync = async (app) => {
  async function invalidateApiKeyCache(apiKeyId: string): Promise<void> {
    try {
      if (app.redis.status !== 'ready') {
        await app.redis.connect();
      }
      const hash = await app.redis.get(authIdMapKey(apiKeyId));
      if (hash) {
        await app.redis.del(authCacheKey(hash), authIdMapKey(apiKeyId));
      }
    } catch {
      // Best-effort invalidation; short TTL still bounds exposure
    }
  }

  async function cacheAuth(rawKey: string, auth: AuthContext, expiresAt: string | null): Promise<void> {
    const hash = apiKeyCacheId(rawKey);
    const payload: CachedAuth = {
      ...auth,
      expiresAt,
      revokedAt: null,
    };
    await app.redis.set(authCacheKey(hash), JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
    await app.redis.set(authIdMapKey(auth.apiKeyId), hash, 'EX', CACHE_TTL_SECONDS);
  }

  async function resolveAuth(rawKey: string): Promise<AuthContext | null> {
    const hash = apiKeyCacheId(rawKey);
    const cacheKey = authCacheKey(hash);

    try {
      if (app.redis.status !== 'ready') {
        await app.redis.connect();
      }
      const cached = await app.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as CachedAuth;
        if (parsed.revokedAt) {
          await app.redis.del(cacheKey, authIdMapKey(parsed.apiKeyId));
          return null;
        }
        if (parsed.expiresAt && new Date(parsed.expiresAt) < new Date()) {
          await app.redis.del(cacheKey, authIdMapKey(parsed.apiKeyId));
          return null;
        }
        return {
          orgId: parsed.orgId,
          apiKeyId: parsed.apiKeyId,
          scopes: parsed.scopes,
          tier: parsed.tier,
        };
      }
    } catch {
      // Cache miss / Redis unavailable — fall through to DB
    }

    const prefix = rawKey.slice(0, 16);
    const candidates = await prisma.apiKey.findMany({
      where: {
        keyPrefix: prefix,
        revokedAt: null,
      },
      select: {
        id: true,
        orgId: true,
        keyHash: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        org: {
          select: { tier: true },
        },
      },
    });

    for (const candidate of candidates) {
      if (candidate.revokedAt) {
        continue;
      }
      if (candidate.expiresAt && candidate.expiresAt < new Date()) {
        continue;
      }

      const valid = await verifyApiKey(rawKey, candidate.keyHash);
      if (!valid) {
        continue;
      }

      const auth: AuthContext = {
        orgId: candidate.orgId,
        apiKeyId: candidate.id,
        scopes: candidate.scopes,
        tier: candidate.org.tier,
      };

      try {
        await cacheAuth(rawKey, auth, candidate.expiresAt?.toISOString() ?? null);
      } catch {
        // Ignore cache write failures
      }

      void prisma.apiKey
        .update({
          where: { id: candidate.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => undefined);

      return auth;
    }

    return null;
  }

  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const requestId = String(request.id);
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey !== 'string' || rawKey.length < 16) {
      unauthorized(reply, requestId);
      return;
    }

    const auth = await resolveAuth(rawKey);
    if (!auth) {
      unauthorized(reply, requestId);
      return;
    }

    request.auth = auth;

    const agentHeader = request.headers['x-agent-id'];
    const agentId = typeof agentHeader === 'string' ? agentHeader : undefined;
    const route = `${request.method}:${request.routeOptions.url ?? request.url}`;

    const allowed = await enforceRateLimit({
      redis: app.redis,
      orgId: auth.orgId,
      apiKeyId: auth.apiKeyId,
      tier: auth.tier,
      agentId,
      route,
      request,
      reply,
    });
    if (!allowed) {
      return;
    }
  }

  app.decorate('authenticate', authenticate);
  app.decorate('invalidateApiKeyCache', invalidateApiKeyCache);

  app.decorate('requireScopes', (...required: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticate(request, reply);
      if (reply.sent) {
        return;
      }

      const scopes = request.auth?.scopes ?? [];
      const missing = required.filter((scope) => !scopes.includes(scope));
      if (missing.length > 0) {
        forbidden(
          reply,
          String(request.id),
          `Missing required scope(s): ${missing.join(', ')}`,
        );
      }
    };
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin',
});
