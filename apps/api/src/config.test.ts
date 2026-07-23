import { describe, expect, it } from 'vitest';
import { loadEnv } from './config.js';

describe('loadEnv', () => {
  it('parses valid environment variables', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws when required vars are missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/Invalid environment configuration/);
  });
});
