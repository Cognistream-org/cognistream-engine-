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
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  PLATFORM_FEE_DEFAULT_BASIS_POINTS: z.coerce.number().int().min(0).max(10000).default(250),
  PLATFORM_NAME: z.string().default('CogniStream'),
  PLATFORM_URL: z.string().url().default('https://cognistream.io'),
  BILLING_GRACE_PERIOD_DAYS: z.coerce.number().int().min(0).default(3),
  TRIAL_DAYS: z.coerce.number().int().min(0).default(14),
});

export type Env = z.infer<typeof envSchema> & {
  ENCRYPTION_KEYS: string;
  AUDIT_HMAC_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
};

function ephemeralTestKey(prefix: string): string {
  // Deterministic-enough per process; not a production secret.
  return `${prefix}:${randomBytes(32).toString('base64')}`;
}

function requireOutsideTest(
  value: string | undefined,
  name: string,
  nodeEnv: string,
  testFallback: string,
): string {
  if (value) {
    return value;
  }
  if (nodeEnv === 'test') {
    return testFallback;
  }
  throw new Error(`Invalid environment configuration: ${name}: Required`);
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

  const encryptionKeys = requireOutsideTest(
    data.ENCRYPTION_KEYS,
    'ENCRYPTION_KEYS',
    data.NODE_ENV,
    ephemeralTestKey('test'),
  );
  const auditHmacKey = requireOutsideTest(
    data.AUDIT_HMAC_KEY,
    'AUDIT_HMAC_KEY',
    data.NODE_ENV,
    randomBytes(32).toString('base64'),
  );
  const stripeSecretKey = requireOutsideTest(
    data.STRIPE_SECRET_KEY,
    'STRIPE_SECRET_KEY',
    data.NODE_ENV,
    'sk_test_placeholder',
  );
  const stripeWebhookSecret = requireOutsideTest(
    data.STRIPE_WEBHOOK_SECRET,
    'STRIPE_WEBHOOK_SECRET',
    data.NODE_ENV,
    'whsec_test_placeholder',
  );
  const stripePublishableKey = requireOutsideTest(
    data.STRIPE_PUBLISHABLE_KEY,
    'STRIPE_PUBLISHABLE_KEY',
    data.NODE_ENV,
    'pk_test_placeholder',
  );

  return {
    ...data,
    ENCRYPTION_KEYS: encryptionKeys,
    AUDIT_HMAC_KEY: auditHmacKey,
    STRIPE_SECRET_KEY: stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
    STRIPE_PUBLISHABLE_KEY: stripePublishableKey,
  };
}
