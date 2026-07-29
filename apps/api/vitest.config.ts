import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';

config({ path: resolve(__dirname, '.env') });

// Deterministic keys for unit/integration tests (not production secrets).
if (!process.env.ENCRYPTION_KEYS) {
  process.env.ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 1).toString('base64')}`;
}
if (!process.env.AUDIT_HMAC_KEY) {
  process.env.AUDIT_HMAC_KEY = Buffer.alloc(32, 2).toString('base64');
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/test/**',
        'src/scripts/**',
        // Auth plugin is exercised by integration suites; Redis failure branches skew metrics.
        'src/plugins/auth.ts',
        // OTEL NodeSDK bootstrap is process-global and side-effectful; covered by sdk unit smoke tests.
        'src/telemetry/sdk.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90,
      },
    },
  },
});
