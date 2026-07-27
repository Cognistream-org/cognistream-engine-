import client, { type Registry } from 'prom-client';

const SERVICE_NAME = 'cognistream-api';

let registry: Registry | null = null;

export const transactionsTotal = new client.Counter({
  name: 'cognistream_transactions_total',
  help: 'Total number of transactions by status and type',
  labelNames: ['status', 'type'] as const,
});

export const escrowActiveAmountCents = new client.Gauge({
  name: 'cognistream_escrow_active_amount_cents',
  help: 'Total amount currently held in active escrows (integer cents)',
});

export const disputeResolutionDurationSeconds = new client.Histogram({
  name: 'cognistream_dispute_resolution_duration_seconds',
  help: 'Duration of dispute resolution operations in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const webhookDeliveryDurationSeconds = new client.Histogram({
  name: 'cognistream_webhook_delivery_duration_seconds',
  help: 'Duration of webhook delivery attempts in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const rateLimitHitsTotal = new client.Counter({
  name: 'cognistream_rate_limit_hits_total',
  help: 'Total number of rate-limit rejections',
  labelNames: ['endpoint', 'org_id'] as const,
});

export const dbQueryDurationSeconds = new client.Histogram({
  name: 'cognistream_db_query_duration_seconds',
  help: 'Prisma/database query duration in seconds',
  labelNames: ['operation', 'model'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

export const redisOperationDurationSeconds = new client.Histogram({
  name: 'cognistream_redis_operation_duration_seconds',
  help: 'Redis operation duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
});

export function initMetrics(options?: { collectDefaultMetrics?: boolean }): Registry {
  if (registry) {
    return registry;
  }

  registry = new client.Registry();
  registry.setDefaultLabels({ service: SERVICE_NAME });

  registry.registerMetric(transactionsTotal);
  registry.registerMetric(escrowActiveAmountCents);
  registry.registerMetric(disputeResolutionDurationSeconds);
  registry.registerMetric(webhookDeliveryDurationSeconds);
  registry.registerMetric(rateLimitHitsTotal);
  registry.registerMetric(dbQueryDurationSeconds);
  registry.registerMetric(redisOperationDurationSeconds);

  if (options?.collectDefaultMetrics !== false) {
    client.collectDefaultMetrics({ register: registry });
  }

  return registry;
}

export function getMetricsRegistry(): Registry {
  return registry ?? initMetrics();
}

export async function renderMetrics(): Promise<string> {
  return getMetricsRegistry().metrics();
}

export function resetMetricsForTests(): void {
  transactionsTotal.reset();
  escrowActiveAmountCents.reset();
  disputeResolutionDurationSeconds.reset();
  webhookDeliveryDurationSeconds.reset();
  rateLimitHitsTotal.reset();
  dbQueryDurationSeconds.reset();
  redisOperationDurationSeconds.reset();
  registry?.resetMetrics();
  registry = null;
}

export function recordTransaction(status: string, type: string): void {
  transactionsTotal.inc({ status, type });
}

export function adjustEscrowActiveAmount(deltaCents: number): void {
  escrowActiveAmountCents.inc(deltaCents);
}

export function setEscrowActiveAmount(amountCents: number): void {
  escrowActiveAmountCents.set(amountCents);
}

export function observeDisputeResolution(seconds: number): void {
  disputeResolutionDurationSeconds.observe(seconds);
}

export function observeWebhookDelivery(seconds: number): void {
  webhookDeliveryDurationSeconds.observe(seconds);
}

export function recordRateLimitHit(endpoint: string, orgId: string): void {
  rateLimitHitsTotal.inc({ endpoint, org_id: orgId });
}

export function observeDbQuery(operation: string, model: string, seconds: number): void {
  dbQueryDurationSeconds.observe({ operation, model }, seconds);
}

export function observeRedisOperation(operation: string, seconds: number): void {
  redisOperationDurationSeconds.observe({ operation }, seconds);
}
