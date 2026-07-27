import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import type { Logger } from 'pino';

export type TelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** OTLP HTTP endpoint, e.g. http://localhost:4318/v1/traces */
  otlpEndpoint?: string;
};

let sdk: NodeSDK | null = null;
let started = false;

export function buildTelemetryConfig(env: {
  OTEL_ENABLED: boolean;
  OTEL_SERVICE_NAME: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  NODE_ENV: string;
  npm_package_version?: string;
}): TelemetryConfig {
  return {
    enabled: env.OTEL_ENABLED,
    serviceName: env.OTEL_SERVICE_NAME,
    serviceVersion: env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
}

export async function startTelemetry(
  config: TelemetryConfig,
  logger?: Logger,
): Promise<void> {
  if (!config.enabled || started) {
    return;
  }

  const endpoint =
    config.otlpEndpoint?.replace(/\/$/, '') ?? 'http://localhost:4318/v1/traces';
  const url = endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`;

  const exporter = new OTLPTraceExporter({ url });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment': config.environment,
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  started = true;
  logger?.info(
    { otlpEndpoint: url, serviceName: config.serviceName },
    'OpenTelemetry tracing started',
  );
}

export async function shutdownTelemetry(logger?: Logger): Promise<void> {
  if (!sdk || !started) {
    return;
  }
  try {
    await sdk.shutdown();
    logger?.info('OpenTelemetry tracing shut down');
  } catch (error) {
    logger?.warn({ err: error }, 'OpenTelemetry shutdown failed');
  } finally {
    sdk = null;
    started = false;
  }
}

export function isTelemetryStarted(): boolean {
  return started;
}
