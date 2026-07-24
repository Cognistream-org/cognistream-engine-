import 'dotenv/config';
import cron from 'node-cron';
import { loadEnv } from './config.js';
import { buildApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { processExpiredEscrows } from './jobs/escrow-refund.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
  });

  const app = await buildApp(env, logger);

  // Escrow auto-refund every 5 minutes
  const refundJob = cron.schedule('*/5 * * * *', () => {
    void processExpiredEscrows(app.redis)
      .then((result) => {
        if (result.processed > 0) {
          logger.info(result, 'Escrow auto-refund job completed');
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Escrow auto-refund job failed');
      });
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    refundJob.stop();
    await app.close();
    await prisma.$disconnect();
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
    process.exit(1);
  }
}

void main();
