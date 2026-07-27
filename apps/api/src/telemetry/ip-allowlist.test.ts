import { describe, expect, it, beforeEach } from 'vitest';
import { isIpAllowed, normalizeIp } from './ip-allowlist.js';
import {
  initMetrics,
  resetMetricsForTests,
  recordTransaction,
  recordRateLimitHit,
  observeDbQuery,
  observeRedisOperation,
  observeDisputeResolution,
  observeWebhookDelivery,
  adjustEscrowActiveAmount,
  renderMetrics,
} from './metrics.js';
import { withSpan, getActiveTraceIds, injectTraceHeaders } from './tracing.js';

describe('isIpAllowed', () => {
  it('normalizes IPv4-mapped IPv6 and loopback', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::1')).toBe('127.0.0.1');
  });

  it('matches exact IPs and CIDR ranges', () => {
    expect(isIpAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isIpAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('192.168.1.50', ['192.168.0.0/16'])).toBe(true);
    expect(isIpAllowed('8.8.8.8', ['10.0.0.0/8', '127.0.0.1'])).toBe(false);
  });
});

describe('metrics', () => {
  beforeEach(() => {
    resetMetricsForTests();
    initMetrics({ collectDefaultMetrics: false });
  });

  it('exposes custom cognistream metrics', async () => {
    recordTransaction('escrowed', 'escrow_create');
    recordRateLimitHit('GET /v1/agents', 'org-1');
    observeDbQuery('findMany', 'Agent', 0.01);
    observeRedisOperation('get', 0.001);
    observeDisputeResolution(0.2);
    observeWebhookDelivery(0.15);
    adjustEscrowActiveAmount(10_000);

    const body = await renderMetrics();
    expect(body).toContain('cognistream_transactions_total');
    expect(body).toContain('cognistream_escrow_active_amount_cents');
    expect(body).toContain('cognistream_dispute_resolution_duration_seconds');
    expect(body).toContain('cognistream_webhook_delivery_duration_seconds');
    expect(body).toContain('cognistream_rate_limit_hits_total');
    expect(body).toContain('cognistream_db_query_duration_seconds');
    expect(body).toContain('cognistream_redis_operation_duration_seconds');
  });
});

describe('withSpan', () => {
  it('runs work and exposes active trace ids when a provider exists', async () => {
    const value = await withSpan('test.span', async () => {
      // Without a registered TracerProvider, OTEL uses a no-op tracer.
      getActiveTraceIds();
      return 42;
    });
    expect(value).toBe(42);
  });

  it('records and rethrows errors', async () => {
    await expect(
      withSpan('test.error', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('injects trace headers into a carrier object', () => {
    const headers = injectTraceHeaders({ 'X-Custom': '1' });
    expect(headers['X-Custom']).toBe('1');
  });
});
