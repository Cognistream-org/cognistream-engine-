import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createId } from '../lib/uuid.js';
import { errorBody } from '../lib/errors.js';

export const API_VERSION = 'v1';
export const VND_ACCEPT = 'application/vnd.cognistream.v1+json';

const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * API maturity headers for all `/v1/*` routes:
 * X-RateLimit-Limit / Remaining / Reset, X-Request-Id (UUID v7), X-API-Version.
 * Optional Accept: application/vnd.cognistream.v1+json → 406 on mismatch.
 */
const apiMaturityPluginImpl: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1')) return;

    const incoming = request.headers['x-request-id'];
    if (typeof incoming !== 'string' || incoming.length === 0) {
      Object.defineProperty(request, 'id', {
        value: createId(),
        writable: false,
        configurable: true,
      });
    }

    const acceptable = await assertAcceptHeader(request, reply);
    if (!acceptable) {
      return reply;
    }
  });

  // Sync onSend: async hooks delay reply.sent and race with wrapThenable double-send.
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.url.startsWith('/v1')) {
      reply.header('X-API-Version', API_VERSION);
      reply.header('X-Request-Id', String(request.id));
      ensureRateLimitReset(reply);
    }
    done(null, payload);
  });
};

function ensureRateLimitReset(reply: FastifyReply): void {
  if (reply.hasHeader('X-RateLimit-Reset')) return;
  const windowEnd =
    (Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000)) + 1) *
    RATE_LIMIT_WINDOW_SECONDS;
  reply.header('X-RateLimit-Reset', String(windowEnd));
}

export const apiMaturityPlugin = fp(apiMaturityPluginImpl, {
  name: 'api-maturity-plugin',
});

/** Exported for unit tests of Accept negotiation. */
export async function assertAcceptHeader(
  request: Pick<FastifyRequest, 'headers' | 'id'>,
  reply: {
    status: (code: number) => { send: (body: unknown) => Promise<unknown> | unknown };
  },
): Promise<boolean> {
  const accept = request.headers.accept;
  if (typeof accept !== 'string' || accept.length === 0 || accept === '*/*') {
    return true;
  }
  const tokens = accept.split(',').map((t) => t.trim().split(';')[0]!.trim());
  const hasVndConstraint = tokens.some((t) => t.startsWith('application/vnd.cognistream'));
  if (hasVndConstraint && !tokens.includes(VND_ACCEPT)) {
    await reply.status(406).send(
      errorBody('NOT_ACCEPTABLE', `Supported media type: ${VND_ACCEPT}`, String(request.id)),
    );
    return false;
  }
  return true;
}
