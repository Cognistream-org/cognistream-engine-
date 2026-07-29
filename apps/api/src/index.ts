import 'dotenv/config';
import cron from 'node-cron';
import { loadEnv } from './config.js';

async function main(): Promise<void> {
  const env = loadEnv();
  process.env.ENCRYPTION_KEYS = env.ENCRYPTION_KEYS;
  process.env.AUDIT_HMAC_KEY = env.AUDIT_HMAC_KEY;

  // Dynamic imports after encryption keys are set so Prisma extensions see them.
  const { buildApp } = await import('./app.js');
  const { createLogger } = await import('./lib/logger.js');
  const { prisma } = await import('./lib/prisma.js');
  const { processExpiredEscrows } = await import('./jobs/escrow-refund.js');
  const { registerGracefulShutdown } = await import('./resilience/graceful-shutdown.js');
  const { stopAuditRuntime } = await import('./security/audit-runtime.js');
  const {
    buildTelemetryConfig,
    startTelemetry,
    shutdownTelemetry,
    withSpan,
    captureContext,
    withCapturedContext,
  } = await import('./telemetry/index.js');

  const logger = createLogger({
    level: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
  });

  // OTEL must start before Fastify so auto-instrumentation can patch modules.
  await startTelemetry(
    buildTelemetryConfig({
      OTEL_ENABLED: env.NODE_ENV === 'test' ? false : env.OTEL_ENABLED,
      OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      NODE_ENV: env.NODE_ENV,
      npm_package_version: env.APP_VERSION,
    }),
    logger,
  );

  const app = await buildApp(env, logger);

  // Escrow auto-refund every 5 minutes — preserve trace context across the async job.
  const refundJob = cron.schedule('*/5 * * * *', () => {
    const ctx = captureContext();
    void withCapturedContext(ctx, async () =>
      withSpan('job.escrow_auto_refund', async () => {
        const result = await processExpiredEscrows(app.redis);
        if (result.processed > 0) {
          logger.info(result, 'Escrow auto-refund job completed');
        }
        return result;
      }),
    ).catch((error: unknown) => {
      logger.error({ err: error }, 'Escrow auto-refund job failed');
    });
  });

  registerGracefulShutdown({
    app,
    redis: app.redis,
    prisma,
    logger,
    onBeforeClose: async () => {
      refundJob.stop();
      await stopAuditRuntime();
      await shutdownTelemetry(logger);
    },
  });

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    logger.info({ host: env.API_HOST, port: env.API_PORT }, 'API listening');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start API');
    refundJob.stop();
    await stopAuditRuntime();
    await prisma.$disconnect();
    await shutdownTelemetry(logger);
    process.exit(1);
  }
}

void main();
