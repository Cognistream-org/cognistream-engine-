import { describe, expect, it } from 'vitest';
import { buildTelemetryConfig, isTelemetryStarted } from './sdk.js';

describe('buildTelemetryConfig', () => {
  it('maps env into telemetry config', () => {
    const config = buildTelemetryConfig({
      OTEL_ENABLED: true,
      OTEL_SERVICE_NAME: 'cognistream-api',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
      NODE_ENV: 'development',
      npm_package_version: '0.1.0',
    });

    expect(config.enabled).toBe(true);
    expect(config.serviceName).toBe('cognistream-api');
    expect(config.otlpEndpoint).toBe('http://localhost:4318/v1/traces');
    expect(isTelemetryStarted()).toBe(false);
  });
});
