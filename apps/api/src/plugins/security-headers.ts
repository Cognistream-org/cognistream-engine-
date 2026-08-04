import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export type SecurityHeadersOptions = {
  /** When true, emit Strict-Transport-Security (production only). */
  enableHsts: boolean;
};

/**
 * Production-safe response headers (Helmet-equivalent, explicit allowlist).
 * Applied to all responses via onSend.
 */
const securityHeadersPluginImpl: FastifyPluginAsync<SecurityHeadersOptions> = async (
  app,
  opts,
) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Content-Security-Policy', "default-src 'self'");
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    if (opts.enableHsts) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    return payload;
  });
};

export const securityHeadersPlugin = fp(securityHeadersPluginImpl, {
  name: 'security-headers-plugin',
});
