import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { securityHeadersPlugin } from './security-headers.js';
import { apiMaturityPlugin } from './api-maturity.js';

async function collectUnhandled(run: () => Promise<void>): Promise<Error[]> {
  const unhandled: Error[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason instanceof Error ? reason : new Error(String(reason)));
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

describe('onSend sync vs async wrapThenable race', () => {
  it('production sync header hooks: early return after send does not ERR_HTTP_HEADERS_SENT', async () => {
    const unhandled = await collectUnhandled(async () => {
      const app = Fastify();
      await app.register(securityHeadersPlugin, { enableHsts: false });
      await app.register(apiMaturityPlugin);
      app.get('/v1/early', async (_request, reply) => {
        void reply.status(404).send({ error: 'missing' });
        return;
      });
      app.get('/v1/ok', async (_request, reply) => {
        return reply.status(200).send({ ok: true });
      });
      await app.ready();

      for (let i = 0; i < 20; i += 1) {
        expect((await app.inject({ method: 'GET', url: '/v1/early' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/v1/ok' })).statusCode).toBe(200);
      }
      await app.close();
    });

    expect(
      unhandled.filter((e) => (e as NodeJS.ErrnoException).code === 'ERR_HTTP_HEADERS_SENT'),
    ).toEqual([]);
  });

  it('control: delayed async onSend still races on early return', async () => {
    const unhandled = await collectUnhandled(async () => {
      const app = Fastify();
      app.addHook('onSend', async (_req, _reply, payload) => {
        await new Promise((r) => setImmediate(r));
        return payload;
      });
      app.get('/v1/early', async (_request, reply) => {
        void reply.status(404).send({ error: 'missing' });
        return;
      });
      await app.ready();
      expect((await app.inject({ method: 'GET', url: '/v1/early' })).statusCode).toBe(404);
      await app.close();
    });

    expect(unhandled.some((e) => (e as NodeJS.ErrnoException).code === 'ERR_HTTP_HEADERS_SENT')).toBe(
      true,
    );
  });
});
