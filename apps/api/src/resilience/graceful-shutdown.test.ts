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

  it('continues when http close times out', async () => {
    const steps: string[] = [];
    await gracefulShutdown({
      signal: 'SIGTERM',
      app: {
        close: async () => {
          await new Promise(() => undefined); // never resolves
        },
      },
      redis: {
        status: 'wait',
        ping: async () => 'PONG',
        quit: async () => undefined,
        disconnect: () => undefined,
      },
      prisma: { $disconnect: async () => undefined },
      logger: {
        info: (_o, msg) => {
          if (msg?.includes('complete')) steps.push('done');
        },
        error: () => undefined,
      },
      exit: () => {
        steps.push('exit');
      },
      inFlightTimeoutMs: 5,
      sleep: async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
      },
    });
    expect(steps).toContain('exit');
    expect(steps).toContain('done');
  });

  it('handles redis ping failure then quit', async () => {
    const quit = vi.fn(async () => undefined);
    await gracefulShutdown({
      signal: 'SIGTERM',
      app: { close: async () => undefined },
      redis: {
        status: 'ready',
        ping: async () => {
          throw new Error('ping fail');
        },
        quit,
        disconnect: () => undefined,
      },
      prisma: { $disconnect: async () => undefined },
      logger: { info: () => undefined, error: () => undefined, flush: (cb) => cb?.() },
      exit: () => undefined,
      sleep: async () => {
        await new Promise(() => undefined);
      },
    });
    expect(quit).toHaveBeenCalled();
  });

  it('disconnects after redis quit throws', async () => {
    const disconnect = vi.fn();
    const error = vi.fn();
    await gracefulShutdown({
      signal: 'SIGTERM',
      app: { close: async () => undefined },
      redis: {
        status: 'ready',
        ping: async () => 'PONG',
        quit: async () => {
          throw new Error('quit fail');
        },
        disconnect,
      },
      prisma: { $disconnect: async () => undefined },
      logger: { info: () => undefined, error, flush: (cb) => cb?.() },
      exit: () => undefined,
      sleep: async () => {
        await new Promise(() => undefined);
      },
    });
    expect(error).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('skips pino flush when logger.flush is absent', async () => {
    const exit = vi.fn();
    await gracefulShutdown({
      signal: 'SIGINT',
      app: { close: async () => undefined },
      redis: {
        status: 'wait',
        ping: async () => 'PONG',
        quit: async () => undefined,
        disconnect: () => undefined,
      },
      prisma: { $disconnect: async () => undefined },
      logger: { info: () => undefined, error: () => undefined },
      exit,
      sleep: async () => {
        await new Promise(() => undefined);
      },
    });
    expect(exit).toHaveBeenCalledWith(0);
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

  it('exits with code 1 when shutdown throws', async () => {
    const exit = vi.fn();
    const error = vi.fn();
    const unregister = registerGracefulShutdown({
      app: {
        close: async () => {
          throw new Error('close boom');
        },
      },
      redis: {
        status: 'wait',
        ping: async () => 'PONG',
        quit: async () => undefined,
        disconnect: () => undefined,
      },
      prisma: { $disconnect: async () => undefined },
      logger: { info: () => undefined, error, flush: (cb) => cb?.() },
      exit,
      signals: ['SIGUSR2' as NodeJS.Signals],
    });

    process.emit('SIGUSR2' as NodeJS.Signals, 'SIGUSR2' as NodeJS.Signals);
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(error).toHaveBeenCalled();
    unregister();
  });
});
