export {
  startTelemetry,
  shutdownTelemetry,
  buildTelemetryConfig,
  isTelemetryStarted,
  type TelemetryConfig,
} from './sdk.js';

export {
  withSpan,
  getTracer,
  getActiveTraceIds,
  captureContext,
  withCapturedContext,
  injectTraceHeaders,
  extractTraceContext,
  type SpanAttributes,
} from './tracing.js';

export {
  initMetrics,
  getMetricsRegistry,
  renderMetrics,
  resetMetricsForTests,
  recordTransaction,
  adjustEscrowActiveAmount,
  setEscrowActiveAmount,
  observeDisputeResolution,
  observeWebhookDelivery,
  recordRateLimitHit,
  observeDbQuery,
  observeRedisOperation,
  transactionsTotal,
  escrowActiveAmountCents,
  disputeResolutionDurationSeconds,
  webhookDeliveryDurationSeconds,
  rateLimitHitsTotal,
  dbQueryDurationSeconds,
  redisOperationDurationSeconds,
} from './metrics.js';

export { isIpAllowed, normalizeIp } from './ip-allowlist.js';
export { metricsRoutes, type MetricsRouteOptions } from './metrics-route.js';
