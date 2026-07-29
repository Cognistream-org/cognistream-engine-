import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { apiMaturityPlugin, assertAcceptHeader, VND_ACCEPT } from './api-maturity.js';

describe('assertAcceptHeader', () => {
  it('allows missing, */*, and application/json', async () => {
    const reply = { status: vi.fn(() => ({ send: vi.fn(async () => undefined) })) };
    expect(await assertAcceptHeader({ headers: {}, id: '1' }, reply)).toBe(true);
    expect(
      await assertAcceptHeader({ headers: { accept: '*/*' }, id: '1' }, reply),
    ).toBe(true);
    expect(
      await assertAcceptHeader({ headers: { accept: 'application/json' }, id: '1' }, reply),
    ).toBe(true);
  });

  it('rejects wrong cognistream vendor version with 406', async () => {
    const send = vi.fn(async () => undefined);
    const status = vi.fn(() => ({ send }));
    const ok = await assertAcceptHeader(
      { headers: { accept: 'application/vnd.cognistream.v2+json' }, id: 'req-1' },
      { status },
    );
    expect(ok).toBe(false);
    expect(status).toHaveBeenCalledWith(406);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_ACCEPTABLE' }),
      }),
    );
  });

  it('accepts the v1 vendor media type', async () => {
    const reply = { status: vi.fn(() => ({ send: vi.fn(async () => undefined) })) };
    expect(
      await assertAcceptHeader({ headers: { accept: VND_ACCEPT }, id: '1' }, reply),
    ).toBe(true);
    expect(reply.status).not.toHaveBeenCalled();
  });
});

describe('apiMaturityPlugin', () => {
  it('sets maturity headers on /v1 responses', async () => {
    const app = Fastify({ genReqId: () => 'will-be-replaced' });
    await app.register(apiMaturityPlugin);
    app.get('/v1/ping', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));

    const v1 = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(v1.statusCode).toBe(200);
    expect(v1.headers['x-api-version']).toBe('v1');
    expect(v1.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(v1.headers['x-ratelimit-reset']).toBeDefined();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.headers['x-api-version']).toBeUndefined();

    await app.close();
  });

  it('returns 406 for mismatched Accept on /v1', async () => {
    const app = Fastify();
    await app.register(apiMaturityPlugin);
    app.get('/v1/ping', async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { accept: 'application/vnd.cognistream.v9+json' },
    });
    expect(res.statusCode).toBe(406);
    expect(res.json().error.code).toBe('NOT_ACCEPTABLE');

    await app.close();
  });
});
