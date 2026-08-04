import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  corsPlugin,
} from './cors.js';

describe('corsPlugin', () => {
  it('allows whitelisted Origin and reflects credentials', async () => {
    const app = Fastify();
    await app.register(corsPlugin, {
      origins: ['http://localhost:3000', 'https://dashboard.cognistream.io'],
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');

    await app.close();
  });

  it('rejects origins outside the whitelist', async () => {
    const app = Fastify();
    await app.register(corsPlugin, {
      origins: ['http://localhost:3000'],
    });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ping',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  it('exports the configured method and header allowlists', () => {
    expect(CORS_ALLOWED_METHODS).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(CORS_ALLOWED_HEADERS).toContain('X-API-Key');
    expect(CORS_ALLOWED_HEADERS).toContain('Idempotency-Key');
  });
});
