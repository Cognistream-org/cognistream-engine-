import 'dotenv/config';
import cron from 'node-cron';
import { loadEnv } from './config.js';
import { buildApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { processExpiredEscrows } from './jobs/escrow-refund.js';
import {
  buildTelemetryConfig,
  startTelemetry,
  shutdownTelemetry,
  withSpan,
  captureContext,
  withCapturedContext,
} from './telemetry/index.js';

async function main(): Promise<void> {
  const env = loadEnv();
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

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    refundJob.stop();
    await app.close();
    await prisma.$disconnect();
    await shutdownTelemetry(logger);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    logger.info({ host: env.API_HOST, port: env.API_PORT }, 'API listening');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start API');
    refundJob.stop();
    await prisma.$disconnect();
    await shutdownTelemetry(logger);
    process.exit(1);
  }
}

void main();
