import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { Redis } from 'ioredis';
import fp from 'fastify-plugin';
import { errorBody } from '../lib/errors.js';
import type { UsageOperation } from '../lib/usage-counters.js';
import {
  checkLimits,
  flushUsageToDatabase,
  recordAgentCreated,
  recordApiCall,
  recordDisputeCreated,
  recordTransaction,
  recordWebhookCreated,
  type BillingOptions,
} from '../services/billing.js';

export const USAGE_FLUSH_INTERVAL_MS = 60_000;

type UsageMeterPlan = {
  record: UsageOperation[];
  orgId: string;
};

type RequestWithUsage = FastifyRequest & {
  usageMeterPlan?: UsageMeterPlan;
};

function normalizePath(url: string): string {
  const path = (url.split('?')[0] ?? url).replace(/\/+$/, '');
  return path.length === 0 ? '/' : path;
}

/**
 * Map HTTP method + path to meters to check / record.
 */
export function resolveUsageMeters(
  method: string,
  path: string,
): { check: UsageOperation[]; record: UsageOperation[] } {
  const normalized = normalizePath(path);
  const check: UsageOperation[] = ['api_calls'];
  const record: UsageOperation[] = ['api_calls'];

  if (method === 'POST' && /\/v1\/transactions$/.test(normalized)) {
    check.push('transactions', 'transaction_volume_cents');
    record.push('transactions', 'transaction_volume_cents');
  }
  if (method === 'POST' && /\/v1\/agents$/.test(normalized)) {
    check.push('agents');
    record.push('agents');
  }
  if (method === 'POST' && /\/v1\/webhooks$/.test(normalized)) {
    check.push('webhooks');
    record.push('webhooks');
  }
  if (method === 'POST' && /\/v1\/disputes$/.test(normalized)) {
    check.push('disputes');
    record.push('disputes');
  }

  return { check, record };
}

function requestPath(request: FastifyRequest): string {
  if (request.url.startsWith('/v1')) {
    return normalizePath(request.url);
  }
  // RequestRouteOptions does not always expose prefix in Fastify typings.
  const routeOptions = request.routeOptions as { prefix?: string; url?: string };
  const prefix = routeOptions.prefix ?? '';
  const routeUrl = routeOptions.url ?? '';
  const combined = `${prefix}${routeUrl}`;
  if (combined.startsWith('/v1')) {
    return normalizePath(combined);
  }
  return normalizePath(`/v1${routeUrl.startsWith('/') ? routeUrl : `/${routeUrl}`}`);
}

function extractAmountCents(body: unknown): bigint {
  if (!body || typeof body !== 'object') return 0n;
  const raw = (body as { amountCents?: unknown }).amountCents;
  if (typeof raw === 'bigint') return raw < 0n ? 0n : raw;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  return 0n;
}

export async function enforceUsageMetering(options: {
  redis: Redis;
  orgId: string;
  request: FastifyRequest;
  reply: FastifyReply;
  billing?: Omit<BillingOptions, 'redis'>;
}): Promise<boolean> {
  const { redis, orgId, request, reply } = options;
  const billing: BillingOptions = { ...options.billing, redis };
  const requestId = String(request.id);
  const path = requestPath(request);
  const meters = resolveUsageMeters(request.method, path);

  for (const operation of meters.check) {
    const result = await checkLimits(orgId, operation, billing);
    if (result.softWarning) {
      reply.header(
        'X-Usage-Warning',
        result.reason ??
          `${operation} usage at ${result.currentUsage}/${result.limit} (soft limit)`,
      );
    }
    if (!result.allowed) {
      await reply.status(429).send(
        errorBody(
          'QUOTA_EXCEEDED',
          result.reason ?? `Quota exceeded for ${operation}`,
          requestId,
        ),
      );
      return false;
    }
  }

  (request as RequestWithUsage).usageMeterPlan = {
    record: meters.record,
    orgId,
  };
  return true;
}

async function incrementAfterSuccess(
  request: FastifyRequest,
  redis: Redis,
): Promise<void> {
  const plan = (request as RequestWithUsage).usageMeterPlan;
  if (!plan) return;

  const billing: BillingOptions = { redis, requestId: String(request.id) };
  const sourceId = String(request.id);

  for (const operation of plan.record) {
    switch (operation) {
      case 'api_calls':
        await recordApiCall(plan.orgId, billing);
        break;
      case 'transactions':
        await recordTransaction(
          plan.orgId,
          extractAmountCents(request.body),
          sourceId,
          billing,
        );
        break;
      case 'transaction_volume_cents':
        // Handled together with transactions.
        break;
      case 'agents':
        await recordAgentCreated(plan.orgId, sourceId, billing);
        break;
      case 'webhooks':
        await recordWebhookCreated(plan.orgId, sourceId, billing);
        break;
      case 'disputes':
        await recordDisputeCreated(plan.orgId, sourceId, billing);
        break;
      default: {
        const _exhaustive: never = operation;
        return _exhaustive;
      }
    }
  }
}

const usageMeteringPluginImpl: FastifyPluginAsync = async (app) => {
  const usagePreHandler: preHandlerHookHandler = async (request, reply) => {
    if (!request.auth) return;

    const allowed = await enforceUsageMetering({
      redis: app.redis,
      orgId: request.auth.orgId,
      request,
      reply,
    });
    if (!allowed) return;
  };

  // Append after route auth preHandlers so request.auth is populated.
  app.addHook('onRoute', (routeOptions) => {
    const prefix = routeOptions.prefix ?? '';
    const url = routeOptions.url ?? '';
    if (prefix !== '/v1' && !url.startsWith('/v1')) {
      return;
    }

    const existing = routeOptions.preHandler;
    const handlers: preHandlerHookHandler[] = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing as preHandlerHookHandler]
        : [];
    handlers.push(usagePreHandler);
    routeOptions.preHandler = handlers;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/v1')) return;
    if (!request.auth) return;
    if (reply.statusCode >= 400) return;

    try {
      await incrementAfterSuccess(request, app.redis);
    } catch (error) {
      request.log.warn({ err: error }, 'Usage metering increment failed');
    }
  });

  let flushTimer: NodeJS.Timeout | null = null;
  if (process.env.NODE_ENV !== 'test') {
    flushTimer = setInterval(() => {
      void flushUsageToDatabase(app.redis).catch((error: unknown) => {
        app.log.warn({ err: error }, 'Usage flush job failed');
      });
    }, USAGE_FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }

  app.addHook('onClose', async () => {
    if (flushTimer) clearInterval(flushTimer);
  });
};

export const usageMeteringPlugin = fp(usageMeteringPluginImpl, {
  name: 'usage-metering-plugin',
  dependencies: ['auth-plugin'],
});
