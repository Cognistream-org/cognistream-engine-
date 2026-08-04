import type { FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import fp from 'fastify-plugin';

export type CorsPluginOptions = {
  origins: string[];
};

export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'X-API-Key',
  'X-Request-Id',
  'Idempotency-Key',
  'X-Idempotency-Key',
] as const;

/**
 * Explicit CORS whitelist — no wildcard origins.
 * Origins come from CORS_ORIGINS (comma-separated) via loadEnv.
 */
const corsPluginImpl: FastifyPluginAsync<CorsPluginOptions> = async (app, opts) => {
  const allowed = new Set(opts.origins.map((o) => o.trim()).filter(Boolean));

  await app.register(cors, {
    origin(origin, callback) {
      // Non-browser clients omit Origin — disable CORS headers (do not reflect).
      if (!origin) {
        callback(null, false);
        return;
      }
      callback(null, allowed.has(origin));
    },
    credentials: true,
    methods: [...CORS_ALLOWED_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
  });
};

export const corsPlugin = fp(corsPluginImpl, {
  name: 'cors-plugin',
});
