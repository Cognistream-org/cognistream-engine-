import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { checkRedis, createRedisClient } from './redis.js';

vi.mock('ioredis', () => {
  class MockRedis {
    status = 'wait';
    handlers: Record<string, (err: Error) => void> = {};
    on(event: string, cb: (err: Error) => void) {
      this.handlers[event] = cb;
      return this;
    }
    async connect() {
      this.status = 'ready';
    }
    async ping() {
      return 'PONG';
    }
    async quit() {
      this.status = 'end';
    }
    disconnect() {
      this.status = 'end';
    }
  }
  return { Redis: MockRedis, default: MockRedis };
});

describe('redis helpers', () => {
  it('creates a client and checks ping', async () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    const redis = createRedisClient('redis://localhost:6379', logger);
    await expect(checkRedis(redis)).resolves.toBe(true);
  });

  it('returns false when ping fails', async () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    const redis = createRedisClient('redis://localhost:6379', logger);
    vi.spyOn(redis, 'ping').mockRejectedValue(new Error('down'));
    await expect(checkRedis(redis)).resolves.toBe(false);
  });
});
