import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import type Stripe from 'stripe';

const constructEvent = vi.fn();
const handleAccountUpdated = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/stripe.js', () => ({
  getStripeClient: vi.fn(() => ({
    webhooks: { constructEvent },
  })),
}));

vi.mock('../services/stripe-connect.js', () => ({
  handleAccountUpdated: (...args: unknown[]) => handleAccountUpdated(...args),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: { update: vi.fn() },
    invoice: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    platformFeeLedger: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../security/audit-runtime.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/uuid.js', () => ({
  createId: vi.fn(() => '01900000-0000-7000-8000-0000000000wb'),
}));

vi.mock('../resilience/circuit-breaker.js', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    getCircuitBreaker: unknown;
    [key: string]: unknown;
  };
  return {
    ...actual,
    getCircuitBreaker: vi.fn(() => ({
      execute: async <T>(fn: () => Promise<T>) => fn(),
    })),
  };
});

import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../security/audit-runtime.js';
import { processStripeEvent, stripeWebhookRoutes } from './stripe-webhooks.js';

function createMemoryRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  const redis = {
    status: 'ready' as const,
    connect: vi.fn(async () => undefined),
    set: vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number, nx?: string) => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { redis: redis as unknown as Redis, store, counters };
}

function stripeEvent(type: string, object: unknown, id = `evt_${type}`): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    data: { object },
  } as Stripe.Event;
}

describe('processStripeEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles account.updated', async () => {
    const { redis } = createMemoryRedis();
    const account = { id: 'acct_1', charges_enabled: true } as Stripe.Account;
    const result = await processStripeEvent(stripeEvent('account.updated', account), {
      redis,
    });
    expect(result.handled).toBe(true);
    expect(handleAccountUpdated).toHaveBeenCalledWith('acct_1', account, expect.any(Object));
  });

  it('handles customer.subscription.updated', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub-row',
      orgId: 'org-1',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({ id: 'sub-row' } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: 'org-1' } as never);

    const sub = {
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      cancel_at_period_end: false,
      metadata: { orgId: 'org-1', tier: 'developer' },
      items: {
        data: [
          {
            current_period_start: 1_700_000_000,
            current_period_end: 1_700_086_400,
          },
        ],
      },
    } as unknown as Stripe.Subscription;

    await processStripeEvent(stripeEvent('customer.subscription.updated', sub), { redis });
    expect(prisma.subscription.update).toHaveBeenCalled();
  });

  it('handles invoice.paid', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub-row',
      orgId: 'org-1',
    } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-1' } as never);

    const invoice = {
      id: 'in_1',
      customer: 'cus_1',
      status: 'paid',
      amount_due: 4900,
      amount_paid: 4900,
      currency: 'usd',
      number: 'INV-1',
      lines: { data: [] },
      metadata: { orgId: 'org-1' },
    } as unknown as Stripe.Invoice;

    await processStripeEvent(stripeEvent('invoice.paid', invoice), { redis });
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it('handles transfer.created and transfer.failed', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({ id: 'led' } as never);
    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue({
      id: 'led',
      orgId: 'org-1',
    } as never);

    await processStripeEvent(
      stripeEvent('transfer.created', {
        id: 'tr_1',
        created: 1_700_000_000,
        metadata: { transactionId: 'tx-1' },
      }),
      { redis },
    );
    expect(prisma.platformFeeLedger.update).toHaveBeenCalled();

    await processStripeEvent(
      stripeEvent('transfer.failed', {
        id: 'tr_2',
        metadata: { transactionId: 'tx-1' },
      }),
      { redis },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform_fee.transfer_failed_webhook',
        result: 'failure',
      }),
    );
  });


  it('creates subscription when none exists', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.subscription.create).mockResolvedValue({ id: 'sub-new' } as never);

    const sub = {
      id: 'sub_new',
      status: 'trialing',
      customer: { id: 'cus_1' },
      cancel_at_period_end: false,
      trial_end: 1_700_100_000,
      canceled_at: null,
      metadata: { orgId: 'org-1', tier: 'enterprise' },
      items: { data: [] },
      current_period_start: 1_700_000_000,
      current_period_end: 1_700_086_400,
    } as unknown as Stripe.Subscription;

    await processStripeEvent(stripeEvent('customer.subscription.created', sub), { redis });
    expect(prisma.subscription.create).toHaveBeenCalled();
  });

  it('maps subscription statuses and skips create without org/tier', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);

    for (const status of ['past_due', 'canceled', 'unpaid', 'paused', 'incomplete'] as const) {
      await processStripeEvent(
        stripeEvent(
          'customer.subscription.updated',
          {
            id: `sub_${status}`,
            status,
            customer: 'cus_1',
            cancel_at_period_end: true,
            metadata: {},
            items: { data: [] },
          },
          `evt_sub_${status}`,
        ),
        { redis },
      );
    }
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('deletes subscription when present and no-ops when missing', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null);
    await processStripeEvent(
      stripeEvent('customer.subscription.deleted', { id: 'sub_missing' }),
      { redis },
    );
    expect(prisma.subscription.update).not.toHaveBeenCalled();

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-row' } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({ id: 'sub-row' } as never);
    await processStripeEvent(
      stripeEvent('customer.subscription.deleted', { id: 'sub_1' }, 'evt_del_2'),
      { redis },
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'canceled' }),
      }),
    );
  });

  it('updates existing invoices and maps invoice statuses', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub-row',
      orgId: 'org-1',
    } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-row' } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'inv-row' } as never);

    for (const status of ['draft', 'open', 'void', 'uncollectible', null] as const) {
      await processStripeEvent(
        stripeEvent(
          'invoice.created',
          {
            id: `in_${status ?? 'null'}`,
            customer: 'cus_1',
            status,
            amount_due: 100,
            amount_paid: 0,
            currency: 'USD',
            lines: {
              data: [{ id: 'li_1', description: 'fee', amount: 100, quantity: 1 }],
            },
            due_date: 1_700_000_000,
            status_transitions: { paid_at: null },
            metadata: {},
          },
          `evt_inv_${status ?? 'null'}`,
        ),
        { redis },
      );
    }
    expect(prisma.invoice.update).toHaveBeenCalled();
  });

  it('skips invoices without id or org', async () => {
    const { redis } = createMemoryRedis();
    await processStripeEvent(
      stripeEvent('invoice.payment_failed', { id: undefined, customer: null, metadata: {} }),
      { redis },
    );
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    await processStripeEvent(
      stripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_x',
          customer: null,
          metadata: {},
          amount_due: 1,
          amount_paid: 0,
          lines: { data: [] },
        },
        'evt_inv_no_org',
      ),
      { redis },
    );
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('transfer.created without metadata uses updateMany; failed without tx is no-op', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.platformFeeLedger.updateMany).mockResolvedValue({ count: 1 } as never);

    await processStripeEvent(
      stripeEvent('transfer.created', { id: 'tr_nm', created: null, metadata: {} }, 'evt_tr_nm'),
      { redis },
    );
    expect(prisma.platformFeeLedger.updateMany).toHaveBeenCalled();

    await processStripeEvent(
      stripeEvent('transfer.failed', { id: 'tr_f', metadata: {} }, 'evt_tr_f'),
      { redis },
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('uses subscription period fallback when item periods missing', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub-row',
      orgId: 'org-1',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({ id: 'sub-row' } as never);

    await processStripeEvent(
      stripeEvent('customer.subscription.updated', {
        id: 'sub_fb',
        status: 'active',
        customer: 'cus_1',
        cancel_at_period_end: false,
        metadata: { orgId: 'org-1', tier: 'free' },
        items: { data: [{}] },
      }),
      { redis },
    );
    expect(prisma.subscription.update).toHaveBeenCalled();
  });



  it('creates invoice with paid_at on create', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-2' } as never);

    await processStripeEvent(
      stripeEvent('invoice.paid', {
        id: 'in_paid',
        customer: { id: 'cus_2' },
        status: 'paid',
        amount_due: 100,
        amount_paid: 100,
        currency: 'usd',
        number: null,
        invoice_pdf: 'https://pdf',
        hosted_invoice_url: 'https://hosted',
        lines: { data: [] },
        metadata: { orgId: 'org-2' },
        status_transitions: { paid_at: 1_700_000_000 },
      }),
      { redis },
    );
    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAt: expect.any(Date),
        }),
      }),
    );
  });


  it('updates invoice with paid_at transition', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub-row',
      orgId: 'org-1',
    } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 'inv-row' } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'inv-row' } as never);

    await processStripeEvent(
      stripeEvent('invoice.paid', {
        id: 'in_upd_paid',
        customer: 'cus_1',
        status: 'paid',
        amount_due: 100,
        amount_paid: 100,
        currency: 'usd',
        lines: { data: [] },
        metadata: { orgId: 'org-1' },
        status_transitions: { paid_at: 1_700_000_100 },
      }),
      { redis },
    );
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paidAt: expect.any(Date) }),
      }),
    );
  });

  it('acknowledges unknown events', async () => {
    const { redis } = createMemoryRedis();
    const result = await processStripeEvent(stripeEvent('charge.succeeded', { id: 'ch_1' }), {
      redis,
    });
    expect(result.handled).toBe(false);
  });
});

describe('stripeWebhookRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function buildWebhookApp(redis: Redis) {
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(stripeWebhookRoutes, {
      prefix: '/v1',
      webhookSecret: 'whsec_test',
      stripeSecretKey: 'sk_test',
    });
    return app;
  }

  it('rejects invalid signatures with 400', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=bad' },
      payload: { id: 'evt_1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_SIGNATURE');
    await app.close();
  });

  it('rejects missing signature header', async () => {
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      payload: { id: 'evt_1' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 429 when IP rate limit is exceeded', async () => {
    const { redis } = createMemoryRedis();
    redis.incr = vi.fn(async () => 10_001) as never;
    const app = await buildWebhookApp(redis);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'stripe-signature': 't=1,v1=good',
        'x-forwarded-for': '198.51.100.20',
      },
      payload: { id: 'evt_rl' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(constructEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it('processes valid events and skips duplicates idempotently', async () => {
    constructEvent.mockImplementation((_body: Buffer, _sig: string) =>
      stripeEvent('account.updated', { id: 'acct_1' }, 'evt_unique_1'),
    );
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=good', 'content-type': 'application/json' },
      payload: { id: 'evt_unique_1' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ received: true, handled: true });
    expect(handleAccountUpdated).toHaveBeenCalledTimes(1);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=good', 'content-type': 'application/json' },
      payload: { id: 'evt_unique_1' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ received: true, duplicate: true });
    expect(handleAccountUpdated).toHaveBeenCalledTimes(1);

    await app.close();
  });



  it('uses asBuffer fallback when rawBody is absent', async () => {
    constructEvent.mockImplementation((body: Buffer) => {
      expect(Buffer.isBuffer(body) || typeof body === 'string' || body != null).toBe(true);
      return stripeEvent('account.updated', { id: 'acct_buf' }, 'evt_buf');
    });
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'stripe-signature': 't=1,v1=good',
        'content-type': 'text/plain',
      },
      payload: '{"id":"evt_buf"}',
    });
    expect(res.statusCode).toBe(200);
    expect(constructEvent).toHaveBeenCalled();
    await app.close();
  });

  it('rejects invalid JSON body via content-type parser', async () => {
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'stripe-signature': 't=1,v1=good',
        'content-type': 'application/json',
      },
      payload: '{not-json',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });


  it('returns 200 for unknown but valid events', async () => {
    constructEvent.mockImplementation(() =>
      stripeEvent('radar.early_fraud_warning.created', { id: 'iss_1' }, 'evt_unknown'),
    );
    const { redis } = createMemoryRedis();
    const app = await buildWebhookApp(redis);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=good' },
      payload: { id: 'evt_unknown' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true, handled: false });
    await app.close();
  });
});
