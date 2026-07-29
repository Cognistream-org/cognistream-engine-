export type GracefulShutdownOptions = {
  signal: string;
  app: { close: () => Promise<unknown> };
  redis: {
    status: string;
    quit: () => Promise<unknown>;
    disconnect: () => void;
    ping: () => Promise<unknown>;
  };
  prisma: { $disconnect: () => Promise<unknown> };
  logger: {
    info: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
    flush?: (cb?: (err?: Error) => void) => void;
  };
  /** Max wait for in-flight requests (Fastify close). Default 30s. */
  inFlightTimeoutMs?: number;
  /** Optional pre-close hook (stop cron / workers). */
  onBeforeClose?: () => void | Promise<void>;
  /** Injectable exit for tests. */
  exit?: (code: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_IN_FLIGHT_MS = 30_000;

/**
 * Ordered shutdown:
 * 1. Stop accepting HTTP (Fastify.close)
 * 2. Wait in-flight (max 30s)
 * 3. Flush Redis
 * 4. Close Prisma
 * 5. Flush Pino
 * 6. Exit 0
 */
export async function gracefulShutdown(options: GracefulShutdownOptions): Promise<void> {
  const {
    signal,
    app,
    redis,
    prisma,
    logger,
    onBeforeClose,
    inFlightTimeoutMs = DEFAULT_IN_FLIGHT_MS,
    exit = (code) => {
      process.exit(code);
    },
  } = options;

  const steps: string[] = [];
  logger.info({ signal }, 'Graceful shutdown started');

  if (onBeforeClose) {
    await onBeforeClose();
    steps.push('beforeClose');
  }

  // 1-2: stop accepting + drain in-flight with timeout
  await Promise.race([
    app.close().then(() => {
      steps.push('httpClose');
    }),
    new Promise<void>((resolve) => {
      const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      void sleep(inFlightTimeoutMs).then(() => {
        steps.push('httpCloseTimeout');
        resolve();
      });
    }),
  ]);
  if (!steps.includes('httpClose')) {
    steps.push('httpClose');
  }

  // 3: flush Redis
  try {
    if (redis.status === 'ready') {
      try {
        await redis.ping();
      } catch {
        // best-effort flush signal
      }
      await redis.quit();
    } else {
      redis.disconnect();
    }
    steps.push('redisFlush');
  } catch (error) {
    logger.error({ err: error }, 'Redis shutdown error');
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    steps.push('redisFlush');
  }

  // 4: close Prisma
  await prisma.$disconnect();
  steps.push('prismaClose');

  // 5: flush Pino
  await new Promise<void>((resolve) => {
    if (typeof logger.flush === 'function') {
      logger.flush(() => resolve());
    } else {
      resolve();
    }
  });
  steps.push('pinoFlush');

  logger.info({ signal, steps }, 'Graceful shutdown complete');

  // 6: exit 0
  exit(0);
}

export function registerGracefulShutdown(
  options: Omit<GracefulShutdownOptions, 'signal'> & {
    signals?: NodeJS.Signals[];
  },
): () => void {
  const signals = options.signals ?? (['SIGTERM', 'SIGINT'] as NodeJS.Signals[]);
  let shuttingDown = false;

  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void gracefulShutdown({ ...options, signal }).catch((error: unknown) => {
      options.logger.error({ err: error }, 'Graceful shutdown failed');
      (options.exit ?? process.exit)(1);
    });
  };

  for (const signal of signals) {
    process.on(signal, handler);
  }

  return () => {
    for (const signal of signals) {
      process.off(signal, handler);
    }
  };
}