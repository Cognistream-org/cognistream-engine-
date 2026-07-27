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

export type WebhookEvent =
  | 'transaction.created'
  | 'transaction.settled'
  | 'escrow.released'
  | 'escrow.expired'
  | 'reputation.changed'
  | 'dispute.created'
  | 'dispute.resolved';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 100;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postWithRetry(
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
      const headers = injectTraceHeaders({
        'Content-Type': 'application/json',
        'X-CogniStream-Signature': signature,
        'User-Agent': 'CogniStream-Webhooks/1.0',
      });

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        span.setAttribute('webhook.attempt', attempt);
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body,
          });

          if (response.ok) {
            webhookLogger.info({ ...logContext, attempt, status: response.status }, 'Webhook delivered');
            observeWebhookDelivery(Number(process.hrtime.bigint() - started) / 1e9);
            return;
          }

          webhookLogger.warn(
            { ...logContext, attempt, status: response.status },
            'Webhook delivery non-OK response',
          );
        } catch (error) {
          webhookLogger.warn({ ...logContext, attempt, err: error }, 'Webhook delivery failed');
        }

        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }

      observeWebhookDelivery(Number(process.hrtime.bigint() - started) / 1e9);
      webhookLogger.error(
        { ...logContext, attempts: MAX_ATTEMPTS },
        'Webhook delivery exhausted retries',
      );
    },
    {
      'webhook.id': String(logContext.webhookId ?? ''),
      'organization.id': String(logContext.orgId ?? ''),
    },
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
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
        postWithRetry(hook.url, body, signature, {
          webhookId: hook.id,
          orgId,
          event,
        }),
      );
    }),
  );
}
