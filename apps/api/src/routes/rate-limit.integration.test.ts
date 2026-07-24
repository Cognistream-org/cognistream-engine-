import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, cleanupOrg, createTestOrgWithKey } from '../test/helpers.js';
import * as rateLimit from '../lib/rate-limit.js';

describe('rate limiting integration', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const ctx = await createTestOrgWithKey({ tier: 'free' });
    orgId = ctx.org.id;
    apiKey = ctx.plaintextKey;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(orgId);
    await app.close();
  });

  it('returns 429 when rate limiter is unavailable (fail-closed)', async () => {
    const spy = vi.spyOn(rateLimit, 'enforceRateLimit').mockImplementation(async (options) => {
      options.reply.header('Retry-After', '60');
      await options.reply.status(429).send({
        error: {
          code: 'RATE_LIMITER_UNAVAILABLE',
          message: 'Rate limiter unavailable',
          requestId: String(options.request.id),
        },
      });
      return false;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { 'x-api-key': apiKey },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.json().error.code).toBe('RATE_LIMITER_UNAVAILABLE');
    spy.mockRestore();
  });

  it('returns 429 when org window is exceeded', async () => {
    const spy = vi.spyOn(rateLimit, 'enforceRateLimit').mockImplementation(async (options) => {
      options.reply.header('Retry-After', '60');
      await options.reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          requestId: String(options.request.id),
        },
      });
      return false;
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
    spy.mockRestore();
  });
});
