import { createHmac } from 'node:crypto';
import pino from 'pino';
import { prisma } from '../lib/prisma.js';
import {
  withSpan,
  observeWebhookDelivery,
  injectTraceHeaders,
  captureContext,
  withCapturedContext,
} from '../telemetry/index.js';
import { withRetry } from '../resilience/retry.js';
import { getCircuitBreaker } from '../resilience/circuit-breaker.js';

export type WebhookEvent =
  | 'transaction.created'
  | 'transaction.settled'
  | 'escrow.released'
  | 'escrow.expired'
  | 'reputation.changed'
  | 'dispute.created'
  | 'dispute.resolved';

const webhookLogger = pino({
  name: 'webhooks',
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  redact: {
    paths: ['secret', 'headers.authorization', 'email'],
    censor: '[REDACTED]',
  },
});

export function signWebhookPayload(payload: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hex}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

/**
 * Deliver a signed webhook with circuit breaker + exponential backoff retry,
 * under an OpenTelemetry delivery span with trace header injection.
 */
async function postWebhook(
  url: string,
  body: string,
  signature: string,
  logContext: Record<string, unknown>,
): Promise<void> {
  return withSpan(
    'webhook.delivery',
    async (span) => {
      span.setAttribute('webhook.url_host', safeHost(url));
      span.setAttribute('webhook.event', String(logContext.event ?? ''));

      const started = process.hrtime.bigint();
      // High threshold so per-delivery retries are not cut short by the breaker.
      const breaker = getCircuitBreaker('external_webhook', { failureThreshold: 50 });

      await withRetry(
        async (attempt) => {
          span.setAttribute('webhook.attempt', attempt);
          await breaker.execute(async () => {
            const headers = injectTraceHeaders({
              'Content-Type': 'application/json',
              'X-CogniStream-Signature': signature,
              'User-Agent': 'CogniStream-Webhooks/1.0',
            });

            const response = await fetch(url, {
              method: 'POST',
              headers,
              body,
            });

            if (!response.ok) {
              webhookLogger.warn(
                { ...logContext, attempt, status: response.status },
                'Webhook delivery non-OK response',
              );
              throw new Error(`Webhook HTTP ${response.status}`);
            }

            webhookLogger.info(
              { ...logContext, attempt, status: response.status },
              'Webhook delivered',
            );
          });
        },
        {
          maxAttempts: 6,
          backoffMs:
            process.env.NODE_ENV === 'test' ? [1, 2, 4, 8, 16, 32] : undefined,
          shouldRetry: () => true,
        },
      ).catch((error: unknown) => {
        webhookLogger.error(
          { ...logContext, err: error },
          'Webhook delivery exhausted retries',
        );
      });

      observeWebhookDelivery(Number(process.hrtime.bigint() - started) / 1e9);
    },
    {
      'webhook.id': String(logContext.webhookId ?? ''),
      'organization.id': String(logContext.orgId ?? ''),
    },
  );
}

/**
 * Dispatch a signed webhook event to all matching active endpoints for the org.
 * Failures are logged and retried; they never fail the calling financial path.
 * Trace context is captured and restored so async deliveries stay linked.
 */
export async function dispatchEvent(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const parentCtx = captureContext();

  const webhooks = await prisma.webhook.findMany({
    where: {
      orgId,
      active: true,
      events: { has: event },
    },
    select: {
      id: true,
      url: true,
      secret: true,
    },
  });

  if (webhooks.length === 0) {
    return;
  }

  const envelope = {
    event,
    occurredAt: new Date().toISOString(),
    data: payload,
  };
  const body = JSON.stringify(envelope);

  await Promise.all(
    webhooks.map(async (hook) => {
      const signature = signWebhookPayload(body, hook.secret);
      await withCapturedContext(parentCtx, async () =>
        postWebhook(hook.url, body, signature, {
          webhookId: hook.id,
          orgId,
          event,
        }),
      );
    }),
  );
}
