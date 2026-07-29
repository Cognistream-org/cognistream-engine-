import { describe, expect, it, vi } from 'vitest';
import { gracefulShutdown, registerGracefulShutdown } from './graceful-shutdown.js';

describe('gracefulShutdown', () => {
  it('runs cleanup in order: http → redis → prisma → pino → exit 0', async () => {
    const order: string[] = [];

    const app = {
      close: async () => {
        order.push('http');
      },
    };
    const redis = {
      status: 'ready' as const,
      ping: async () => {
        order.push('redis-ping');
        return 'PONG' as const;
      },
      quit: async () => {
        order.push('redis');
      },
      disconnect: () => undefined,
    };
    const prisma = {
      $disconnect: async () => {
        order.push('prisma');
      },
    };
    const logger = {
      info: () => undefined,
      error: () => undefined,
      flush: (cb?: (err?: Error) => void) => {
        order.push('pino');
        cb?.();
      },
    };
    const exit = (code: number) => {
      order.push(`exit:${code}`);
    };

    await gracefulShutdown({
      signal: 'SIGTERM',
      app,
      redis,
      prisma,
      logger,
      exit,
      onBeforeClose: async () => {
        order.push('before');
      },
      sleep: async () => {
        await new Promise(() => undefined);
      },
    });

    expect(order).toEqual(['before', 'http', 'redis-ping', 'redis', 'prisma', 'pino', 'exit:0']);
  });

  it('disconnects redis when not ready', async () => {
    const disconnect = vi.fn();
    const quit = vi.fn();
    const redis = {
      status: 'wait' as const,
      ping: async () => 'PONG' as const,
      quit,
      disconnect,
    };

    await gracefulShutdown({
      signal: 'SIGINT',
      app: { close: async () => undefined },
      redis,
      prisma: { $disconnect: async () => undefined },
      logger: {
        info: () => undefined,
        error: () => undefined,
        flush: (cb?: (err?: Error) => void) => cb?.(),
      },
      exit: () => undefined,
    });

    expect(disconnect).toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('registerGracefulShutdown', () => {
  it('listens for SIGTERM/SIGINT once', async () => {
    const exit = vi.fn();
    const close = vi.fn(async () => undefined);
    const unregister = registerGracefulShutdown({
      app: { close: () => close() },
      redis: {
        status: 'wait',
        ping: async () => 'PONG' as const,
        quit: async () => undefined,
        disconnect: () => undefined,
      },
      prisma: { $disconnect: async () => undefined },
      logger: {
        info: () => undefined,
        error: () => undefined,
        flush: (cb?: (err?: Error) => void) => cb?.(),
      },
      exit,
      signals: ['SIGTERM', 'SIGINT'],
    });

    process.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });

    process.emit('SIGTERM', 'SIGTERM');
    await new Promise((r) => setTimeout(r, 20));
    expect(close).toHaveBeenCalledTimes(1);

    unregister();
  });
});
