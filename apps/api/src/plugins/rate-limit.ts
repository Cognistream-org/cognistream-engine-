import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Rate limiting is enforced after successful auth via enforceRateLimit:
 * per-org, per-endpoint, and optional per-agent sliding windows (INCR+EXPIRE).
 * Redis outages fail closed with 429.
 */
const rateLimitPluginImpl: FastifyPluginAsync = async () => {
  // Logic lives in lib/rate-limit.ts, invoked from authPlugin.
};

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit-plugin',
  dependencies: ['auth-plugin'],
});
