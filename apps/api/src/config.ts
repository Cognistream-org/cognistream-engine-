import { z } from 'zod';
import { randomBytes } from 'node:crypto';

const csvList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** OpenTelemetry master switch (disabled in test by default via loadEnv callers). */
  OTEL_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  OTEL_SERVICE_NAME: z.string().default('cognistream-api'),
  /** OTLP HTTP traces endpoint (Jaeger all-in-one listens on 4318). */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  /** Comma-separated IPs/CIDRs allowed to scrape /metrics. */
  METRICS_IP_ALLOWLIST: csvList,
  /** Semver shown on health endpoints. */
  APP_VERSION: z.string().default('0.1.0'),
  ENCRYPTION_KEYS: z.string().min(1).optional(),
  AUDIT_HMAC_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema> & {
  ENCRYPTION_KEYS: string;
  AUDIT_HMAC_KEY: string;
};

function ephemeralTestKey(prefix: string): string {
  // Deterministic-enough per process; not a production secret.
  return `${prefix}:${randomBytes(32).toString('base64')}`;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;
  let encryptionKeys = data.ENCRYPTION_KEYS;
  let auditHmacKey = data.AUDIT_HMAC_KEY;

  if (!encryptionKeys) {
    if (data.NODE_ENV === 'test') {
      encryptionKeys = ephemeralTestKey('test');
    } else {
      throw new Error(
        'Invalid environment configuration: ENCRYPTION_KEYS: Required',
      );
    }
  }

  if (!auditHmacKey) {
    if (data.NODE_ENV === 'test') {
      auditHmacKey = randomBytes(32).toString('base64');
    } else {
      throw new Error(
        'Invalid environment configuration: AUDIT_HMAC_KEY: Required',
      );
    }
  }

  return {
    ...data,
    ENCRYPTION_KEYS: encryptionKeys,
    AUDIT_HMAC_KEY: auditHmacKey,
  };
}
