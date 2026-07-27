import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { isIpAllowed } from './ip-allowlist.js';
import { renderMetrics } from './metrics.js';

export type MetricsRouteOptions = {
  allowlist: string[];
};

function resolveClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? request.ip;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

export const metricsRoutes: FastifyPluginAsync<MetricsRouteOptions> = async (app, opts) => {
  const allowlist = opts.allowlist.length > 0 ? opts.allowlist : ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

  app.get('/metrics', async (request, reply) => {
    const ip = resolveClientIp(request);
    if (!isIpAllowed(ip, allowlist)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Metrics endpoint is IP-restricted',
          requestId: String(request.id),
        },
      });
    }

    const body = await renderMetrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(body);
  });
};
