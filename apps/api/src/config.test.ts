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
      OTEL_ENABLED: 'false',
      OTEL_SERVICE_NAME: 'api-test',
      METRICS_IP_ALLOWLIST: '127.0.0.1,10.0.0.0/8',
      APP_VERSION: '1.2.3',
    });

    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('test');
    expect(env.OTEL_ENABLED).toBe(false);
    expect(env.METRICS_IP_ALLOWLIST).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(env.APP_VERSION).toBe('1.2.3');
  });

  it('applies observability defaults', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(env.OTEL_ENABLED).toBe(true);
    expect(env.OTEL_SERVICE_NAME).toBe('cognistream-api');
    expect(env.METRICS_IP_ALLOWLIST).toContain('127.0.0.1');
    expect(env.APP_VERSION).toBe('0.1.0');
  });

  it('throws when required vars are missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/Invalid environment configuration/);
  });
});
