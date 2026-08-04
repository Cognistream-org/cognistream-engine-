import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { securityHeadersPlugin } from './security-headers.js';

describe('securityHeadersPlugin', () => {
  it('sets baseline security headers on every response', async () => {
    const app = Fastify();
    await app.register(securityHeadersPlugin, { enableHsts: false });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    expect(res.headers['content-security-policy']).toBe("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe(
      'geolocation=(), microphone=(), camera=()',
    );
    expect(res.headers['strict-transport-security']).toBeUndefined();

    await app.close();
  });

  it('emits HSTS only when enableHsts is true', async () => {
    const app = Fastify();
    await app.register(securityHeadersPlugin, { enableHsts: true });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );

    await app.close();
  });
});
