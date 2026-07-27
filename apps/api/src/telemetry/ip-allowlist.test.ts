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
  setEscrowActiveAmount,
  renderMetrics,
  getMetricsRegistry,
  initMetrics as initMetricsAgain,
} from './metrics.js';
import {
  withSpan,
  getActiveTraceIds,
  injectTraceHeaders,
  captureContext,
  withCapturedContext,
  extractTraceContext,
} from './tracing.js';

describe('isIpAllowed', () => {
  it('normalizes IPv4-mapped IPv6 and loopback', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::1')).toBe('127.0.0.1');
    expect(normalizeIp('  10.0.0.1  ')).toBe('10.0.0.1');
  });

  it('matches exact IPs and CIDR ranges', () => {
    expect(isIpAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isIpAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('192.168.1.50', ['192.168.0.0/16'])).toBe(true);
    expect(isIpAllowed('8.8.8.8', ['10.0.0.0/8', '127.0.0.1'])).toBe(false);
    expect(isIpAllowed('10.0.0.1', ['0.0.0.0/0'])).toBe(true);
    expect(isIpAllowed('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
  });

  it('rejects empty IP, blank rules, and malformed CIDR/IPv4', () => {
    expect(isIpAllowed('   ', ['127.0.0.1'])).toBe(false);
    expect(isIpAllowed('10.0.0.1', ['', '  ', '10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('10.0.0.1', ['not-a-cidr/'])).toBe(false);
    expect(isIpAllowed('10.0.0.1', ['10.0.0.0/99'])).toBe(false);
    expect(isIpAllowed('10.0.0.1', ['10.0.0.0/-1'])).toBe(false);
    expect(isIpAllowed('999.1.1.1', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('1.2.3.4', ['bad.network/8'])).toBe(false);
    expect(isIpAllowed('1.2.3.256', ['1.2.3.0/24'])).toBe(false);
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
    setEscrowActiveAmount(42_000);

    const body = await renderMetrics();
    expect(body).toContain('cognistream_transactions_total');
    expect(body).toContain('cognistream_escrow_active_amount_cents');
    expect(body).toContain('cognistream_dispute_resolution_duration_seconds');
    expect(body).toContain('cognistream_webhook_delivery_duration_seconds');
    expect(body).toContain('cognistream_rate_limit_hits_total');
    expect(body).toContain('cognistream_db_query_duration_seconds');
    expect(body).toContain('cognistream_redis_operation_duration_seconds');
  });

  it('returns existing registry on re-init and getMetricsRegistry after reset', () => {
    const first = getMetricsRegistry();
    const second = initMetricsAgain({ collectDefaultMetrics: false });
    expect(second).toBe(first);

    resetMetricsForTests();
    const recreated = getMetricsRegistry();
    expect(recreated).toBeTruthy();
  });

  it('can enable default process metrics when requested', () => {
    resetMetricsForTests();
    const reg = initMetricsAgain({ collectDefaultMetrics: true });
    expect(reg).toBeTruthy();
  });
});

describe('withSpan', () => {
  it('runs work and exposes active trace ids when a provider exists', async () => {
    const value = await withSpan(
      'test.span',
      async () => {
        // Without a registered TracerProvider, OTEL uses a no-op tracer.
        getActiveTraceIds();
        return 42;
      },
      { 'cognistream.test': true, 'cognistream.skip': undefined },
    );
    expect(value).toBe(42);
  });

  it('records and rethrows errors', async () => {
    await expect(
      withSpan('test.error', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('records non-Error throws without recordException path for Error only', async () => {
    await expect(
      withSpan('test.string-error', async () => {
        throw 'string-boom';
      }),
    ).rejects.toBe('string-boom');
  });

  it('injects and extracts trace headers / captures context', async () => {
    const headers = injectTraceHeaders({ 'X-Custom': '1' });
    expect(headers['X-Custom']).toBe('1');

    const ctx = captureContext();
    const extracted = extractTraceContext({ traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' });
    expect(extracted).toBeTruthy();

    const value = await withCapturedContext(ctx, async () => 7);
    expect(value).toBe(7);

    // No active span → empty ids
    expect(getActiveTraceIds()).toEqual({});
  });
});
