import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { InvoiceStatus, OrganizationTier, SubscriptionStatus } from '@prisma/client';
import type Stripe from 'stripe';
import type { Prisma } from '@prisma/client';
import { errorBody } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { enforceStripeWebhookIpLimit } from '../lib/rate-limit.js';
import { getStripeClient } from '../lib/stripe.js';
import { createId } from '../lib/uuid.js';
import { getCircuitBreaker } from '../resilience/circuit-breaker.js';
import { withIdempotencyKey, withRetry } from '../resilience/retry.js';
import { recordAudit } from '../security/audit-runtime.js';
import { handleAccountUpdated } from '../services/stripe-connect.js';
import {
  clearTransferRetry,
  markLedgerTransferred,
  markTransferRetry,
} from '../services/platform-fee-ledger.js';

const STRIPE_WEBHOOK_BREAKER = 'stripe_webhook';
const STRIPE_EVENT_IDEMPOTENCY_PREFIX = 'stripe-event:';

type RawBodyRequest = FastifyRequest & {
  rawBody?: Buffer | string;
};

function asBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof body === 'object' && 'raw' in (body as object)) {
    const raw = (body as { raw: unknown }).raw;
    if (Buffer.isBuffer(raw)) return raw;
    if (typeof raw === 'string') return Buffer.from(raw);
  }
  return Buffer.from(JSON.stringify(body ?? {}));
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
      return 'unpaid';
    case 'paused':
      return 'paused';
    default:
      return 'unpaid';
  }
}

function mapInvoiceStatus(status: Stripe.Invoice.Status | null): InvoiceStatus {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'open':
      return 'open';
    case 'paid':
      return 'paid';
    case 'void':
      return 'void';
    case 'uncollectible':
      return 'uncollectible';
    default:
      return 'open';
  }
}

function subscriptionPeriod(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  if (
    item &&
    typeof item.current_period_start === 'number' &&
    typeof item.current_period_end === 'number'
  ) {
    return {
      start: new Date(item.current_period_start * 1000),
      end: new Date(item.current_period_end * 1000),
    };
  }
  const legacy = sub as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  if (
    typeof legacy.current_period_start === 'number' &&
    typeof legacy.current_period_end === 'number'
  ) {
    return {
      start: new Date(legacy.current_period_start * 1000),
      end: new Date(legacy.current_period_end * 1000),
    };
  }
  const now = new Date();
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: now, end };
}

function parseTier(value: unknown): OrganizationTier | null {
  if (value === 'free' || value === 'developer' || value === 'enterprise') {
    return value;
  }
  return null;
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const orgId = typeof sub.metadata?.orgId === 'string' ? sub.metadata.orgId : null;
  const tier = parseTier(sub.metadata?.tier);
  const period = subscriptionPeriod(sub);
  const status = mapSubscriptionStatus(sub.status);

  const existing = await prisma.subscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: sub.id },
        ...(orgId ? [{ orgId }] : []),
      ],
    },
    select: { id: true, orgId: true },
  });

  if (!existing) {
    if (!orgId || !tier) return;
    await prisma.subscription.create({
      data: {
        id: createId(),
        orgId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        tier,
        status,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
      select: { id: true },
    });
    return;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      ...(tier ? { tier } : {}),
      status,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    select: { id: true },
  });

  if (tier) {
    await prisma.organization.update({
      where: { id: existing.orgId },
      data: { tier },
      select: { id: true },
    });
  }
}

async function deleteSubscription(sub: Stripe.Subscription): Promise<void> {
  const existing = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
    select: { id: true },
  });
  if (!existing) return;
  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: 'canceled',
      cancelAtPeriodEnd: false,
      canceledAt: new Date(),
      stripeSubscriptionId: sub.id,
    },
    select: { id: true },
  });
}

async function syncInvoice(invoice: Stripe.Invoice): Promise<void> {
  const stripeInvoiceId = invoice.id;
  if (!stripeInvoiceId) return;

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscription = customerId
    ? await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true, orgId: true },
      })
    : null;

  const orgId =
    (typeof invoice.metadata?.orgId === 'string' ? invoice.metadata.orgId : null) ??
    subscription?.orgId;
  if (!orgId) return;

  const amountDue = BigInt(invoice.amount_due ?? 0);
  const amountPaid = BigInt(invoice.amount_paid ?? 0);
  const status = mapInvoiceStatus(invoice.status);
  const invoiceNumber =
    invoice.number ?? `INV-${stripeInvoiceId.replace(/[^a-zA-Z0-9]/g, '').slice(-16)}`;
  const lineItems = (invoice.lines?.data ?? []).map((line) => ({
    id: line.id,
    description: line.description,
    amount: line.amount,
    quantity: line.quantity,
  }));

  const existing = await prisma.invoice.findUnique({
    where: { stripeInvoiceId },
    select: { id: true },
  });

  if (existing) {
    await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        status,
        amountDueCents: amountDue,
        amountPaidCents: amountPaid,
        currency: (invoice.currency ?? 'usd').toLowerCase(),
        pdfUrl: invoice.invoice_pdf ?? null,
        hostedUrl: invoice.hosted_invoice_url ?? null,
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
        paidAt: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : null,
        lineItems: lineItems as Prisma.InputJsonValue,
        subscriptionId: subscription?.id ?? null,
      },
      select: { id: true },
    });
    return;
  }

  await prisma.invoice.create({
    data: {
      id: createId(),
      orgId,
      subscriptionId: subscription?.id ?? null,
      stripeInvoiceId,
      invoiceNumber,
      status,
      amountDueCents: amountDue,
      amountPaidCents: amountPaid,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
      pdfUrl: invoice.invoice_pdf ?? null,
      hostedUrl: invoice.hosted_invoice_url ?? null,
      dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
      paidAt: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : null,
      lineItems: lineItems as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

async function handleTransferCreated(
  transfer: Stripe.Transfer,
  redis: FastifyRequest['server']['redis'],
): Promise<void> {
  const transactionId =
    typeof transfer.metadata?.transactionId === 'string'
      ? transfer.metadata.transactionId
      : null;
  const transferredAt = new Date((transfer.created ?? Math.floor(Date.now() / 1000)) * 1000);

  if (transactionId) {
    await markLedgerTransferred(transactionId, transfer.id, transferredAt);
    await clearTransferRetry(redis, transactionId);
    return;
  }

  await prisma.platformFeeLedger.updateMany({
    where: { stripeTransferId: transfer.id },
    data: { transferredAt },
  });
}

async function handleTransferFailed(
  transfer: Stripe.Transfer,
  redis: FastifyRequest['server']['redis'],
): Promise<void> {
  const transactionId =
    typeof transfer.metadata?.transactionId === 'string'
      ? transfer.metadata.transactionId
      : null;

  if (transactionId) {
    await markTransferRetry(redis, transactionId);
    const ledger = await prisma.platformFeeLedger.findUnique({
      where: { transactionId },
      select: { id: true, orgId: true },
    });
    void recordAudit({
      orgId: ledger?.orgId ?? null,
      action: 'platform_fee.transfer_failed_webhook',
      entityType: 'platform_fee_ledger',
      entityId: ledger?.id ?? transactionId,
      actorType: 'system',
      result: 'failure',
      metadata: {
        stripeTransferId: transfer.id,
        transactionId,
        retry: true,
      },
    });
  }
}

export async function processStripeEvent(
  event: Stripe.Event,
  options: { redis: FastifyRequest['server']['redis']; requestId?: string },
): Promise<{ handled: boolean }> {
  const requestId = options.requestId ?? 'unknown';
  const breaker = getCircuitBreaker(STRIPE_WEBHOOK_BREAKER, { failureThreshold: 10 });

  await withRetry(
    async () =>
      breaker.execute(async () => {
        switch (event.type) {
          case 'account.updated': {
            const account = event.data.object as Stripe.Account;
            await handleAccountUpdated(account.id, account, { requestId });
            break;
          }
          case 'customer.subscription.created':
          case 'customer.subscription.updated': {
            await syncSubscription(event.data.object as Stripe.Subscription);
            break;
          }
          case 'customer.subscription.deleted': {
            await deleteSubscription(event.data.object as Stripe.Subscription);
            break;
          }
          case 'invoice.created':
          case 'invoice.paid':
          case 'invoice.payment_failed': {
            await syncInvoice(event.data.object as Stripe.Invoice);
            break;
          }
          case 'transfer.created': {
            await handleTransferCreated(event.data.object as Stripe.Transfer, options.redis);
            break;
          }
          default: {
            // Stripe Event.Type omits transfer.failed; keep runtime handling.
            if ((event.type as string) === 'transfer.failed') {
              await handleTransferFailed(event.data.object as Stripe.Transfer, options.redis);
            }
            // Acknowledge other unknown events without error.
            break;
          }
        }
      }, requestId),
    {
      maxAttempts: process.env.NODE_ENV === 'test' ? 2 : 4,
      backoffMs: process.env.NODE_ENV === 'test' ? ([1, 2] as const) : undefined,
    },
  );

  const known = new Set([
    'account.updated',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.created',
    'invoice.paid',
    'invoice.payment_failed',
    'transfer.created',
    'transfer.failed',
  ]);

  return { handled: known.has(event.type as string) };
}

const stripeWebhookRoutesImpl: FastifyPluginAsync<{
  webhookSecret: string;
  stripeSecretKey: string;
}> = async (app, opts) => {
  // Encapsulated raw-body parser so Stripe signature verification works.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      (request as RawBodyRequest).rawBody = body;
      try {
        const json = JSON.parse(body.toString('utf8')) as unknown;
        done(null, json);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.post('/webhooks/stripe', async (request, reply) => {
    const requestId = String(request.id);

    const withinLimit = await enforceStripeWebhookIpLimit({
      redis: app.redis,
      request,
      reply,
    });
    if (!withinLimit) {
      return;
    }

    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      return reply
        .status(400)
        .send(errorBody('INVALID_SIGNATURE', 'Missing Stripe-Signature header', requestId));
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? asBuffer(request.body);
    const stripe = getStripeClient(opts.stripeSecretKey);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, opts.webhookSecret);
    } catch {
      return reply
        .status(400)
        .send(errorBody('INVALID_SIGNATURE', 'Invalid Stripe webhook signature', requestId));
    }

    const idempotency = await withIdempotencyKey({
      redis: app.redis,
      key: `${STRIPE_EVENT_IDEMPOTENCY_PREFIX}${event.id}`,
      fn: async () => processStripeEvent(event, { redis: app.redis, requestId }),
    });

    if (idempotency.status === 'duplicate') {
      return reply.status(200).send({ received: true, duplicate: true });
    }

    return reply.status(200).send({
      received: true,
      handled: idempotency.value.handled,
    });
  });
};

export const stripeWebhookRoutes = stripeWebhookRoutesImpl;
