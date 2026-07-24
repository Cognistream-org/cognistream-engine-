import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CogniStreamAuthError,
  CogniStreamClient,
  CogniStreamError,
  CogniStreamRateLimitError,
  CogniStreamValidationError,
} from '../src/index.js';
import { mapAxiosError } from '../src/errors.js';
import { WebSocketClient } from '../src/websocket.js';

const BASE = 'http://localhost:3999';

const agent = {
  id: '01900000-0000-7000-8000-000000000001',
  orgId: 'org-1',
  name: 'Alpha',
  publicKey: 'pk_alpha',
  capabilities: ['chat'],
  pricingModel: null,
  unitPriceCents: null,
  reputationScore: '0.5000',
  status: 'active' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const transaction = {
  id: '01900000-0000-7000-8000-000000000010',
  buyerId: agent.id,
  sellerId: '01900000-0000-7000-8000-000000000002',
  amountCents: '1000',
  feeCents: '5',
  description: 'job',
  metadata: {},
  status: 'escrowed' as const,
  idempotencyKey: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  settledAt: null,
  escrow: {
    id: 'escrow-1',
    transactionId: '01900000-0000-7000-8000-000000000010',
    amountCents: '1000',
    expiresAt: '2026-07-02T00:00:00.000Z',
    released: false,
    releasedAt: null,
  },
};

let failCount = 0;

const server = setupServer(
  http.post(`${BASE}/v1/agents`, () => HttpResponse.json(agent, { status: 201 })),
  http.get(`${BASE}/v1/agents`, () =>
    HttpResponse.json({
      data: [agent],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
  ),
  http.get(`${BASE}/v1/agents/:id`, () => HttpResponse.json(agent)),
  http.post(`${BASE}/v1/agents/:id/activate`, () =>
    HttpResponse.json({ ...agent, status: 'active' }),
  ),
  http.post(`${BASE}/v1/agents/:id/deactivate`, () =>
    HttpResponse.json({ ...agent, status: 'inactive' }),
  ),
  http.post(`${BASE}/v1/transactions`, () =>
    HttpResponse.json({ transaction }, { status: 201 }),
  ),
  http.post(`${BASE}/v1/transactions/:id/release`, () =>
    HttpResponse.json({
      transaction: {
        ...transaction,
        status: 'settled',
        settledAt: '2026-07-01T01:00:00.000Z',
      },
    }),
  ),
  http.get(`${BASE}/v1/transactions/:id`, () => HttpResponse.json({ transaction })),
  http.get(`${BASE}/v1/transactions`, () =>
    HttpResponse.json({
      data: [transaction],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
  ),
  http.post(`${BASE}/v1/transactions/:id/dispute`, () =>
    HttpResponse.json(
      {
        dispute: {
          id: 'dispute-1',
          transactionId: transaction.id,
          raisedById: agent.id,
          reason: 'bad delivery',
          status: 'open',
          resolution: null,
          resolvedAt: null,
          createdAt: '2026-07-01T02:00:00.000Z',
        },
      },
      { status: 201 },
    ),
  ),
  http.get(`${BASE}/v1/disputes`, () =>
    HttpResponse.json({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
  ),
);

function makeClient(overrides?: { agentId?: string; maxRetries?: number }) {
  return new CogniStreamClient({
    apiKey: 'cs_live_test_key_123456',
    baseUrl: BASE,
    maxRetries: overrides?.maxRetries ?? 3,
    agentId: overrides?.agentId ?? agent.id,
  });
}

describe('CogniStreamClient', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    failCount = 0;
  });
  afterAll(() => server.close());

  it('creates, lists, gets, activates, and deactivates agents', async () => {
    const c = makeClient();
    const created = await c.createAgent({
      name: 'Alpha',
      publicKey: 'pk_alpha',
      capabilities: ['chat'],
    });
    expect(created.id).toBe(agent.id);

    const listed = await c.listAgents({ page: 1, capability: 'chat' });
    expect(listed.data).toHaveLength(1);
    expect((await c.getAgent(agent.id)).name).toBe('Alpha');
    expect((await c.activateAgent(agent.id)).status).toBe('active');
    expect((await c.deactivateAgent(agent.id)).status).toBe('inactive');
  });

  it('creates transaction and releases escrow', async () => {
    const c = makeClient();
    const tx = await c.createTransaction({
      agentId: agent.id,
      sellerId: transaction.sellerId,
      amountCents: 1000,
      idempotencyKey: 'idem-1',
    });
    expect(tx.status).toBe('escrowed');

    const settled = await c.releaseEscrow(tx.id, { rating: 5, review: 'great' });
    expect(settled.status).toBe('settled');

    const fetched = await c.getTransaction(tx.id);
    expect(fetched.id).toBe(tx.id);

    const list = await c.listTransactions({ status: 'escrowed', page: 1 });
    expect(list.meta.total).toBe(1);
  });

  it('raises and lists disputes', async () => {
    const c = makeClient();
    const dispute = await c.raiseDispute(transaction.id, 'bad delivery');
    expect(dispute.status).toBe('open');
    const list = await c.listDisputes({ status: 'open' });
    expect(list.meta.total).toBe(0);
  });

  it('requires agentId to raise disputes', async () => {
    const c = new CogniStreamClient({
      apiKey: 'cs_live_test_key_123456',
      baseUrl: BASE,
    });
    await expect(c.raiseDispute(transaction.id, 'x')).rejects.toThrow(/agentId/i);
  });

  it('maps auth, validation, rate limit, and generic errors via public methods', async () => {
    const c = makeClient({ maxRetries: 0 });

    server.use(
      http.get(`${BASE}/v1/agents/:id`, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'bad key', requestId: 'r1' } },
          { status: 401 },
        ),
      ),
    );
    await expect(c.getAgent(agent.id)).rejects.toBeInstanceOf(CogniStreamAuthError);

    server.use(
      http.get(`${BASE}/v1/agents/:id`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              requestId: 'r2',
              details: [{ path: 'id', message: 'invalid' }],
            },
          },
          { status: 422 },
        ),
      ),
    );
    await expect(c.getAgent(agent.id)).rejects.toBeInstanceOf(CogniStreamValidationError);

    server.use(
      http.get(`${BASE}/v1/agents/:id`, () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'slow down', requestId: 'r3' } },
          { status: 429, headers: { 'Retry-After': '42' } },
        ),
      ),
    );
    try {
      await c.getAgent(agent.id);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CogniStreamRateLimitError);
      expect((err as CogniStreamRateLimitError).retryAfter).toBe(42);
    }

    server.use(
      http.get(`${BASE}/v1/agents/:id`, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r4' } },
          { status: 500 },
        ),
      ),
    );
    await expect(c.getAgent(agent.id)).rejects.toBeInstanceOf(CogniStreamError);
  });

  it('mapAxiosError covers non-axios and header fallbacks', () => {
    expect(() => mapAxiosError(new Error('plain'))).toThrow('plain');
    expect(() => mapAxiosError('string-error')).toThrow();
    try {
      mapAxiosError({
        isAxiosError: true,
        message: 'rl',
        response: {
          status: 429,
          headers: {},
          data: { error: { message: 'limited' } },
        },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CogniStreamRateLimitError);
      expect((err as CogniStreamRateLimitError).retryAfter).toBe(60);
    }
    try {
      mapAxiosError({
        isAxiosError: true,
        message: 'forbidden',
        response: { status: 403, headers: {}, data: {} },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CogniStreamAuthError);
    }
  });

  it('retries on 5xx then succeeds', async () => {
    const c = makeClient({ maxRetries: 3 });
    server.use(
      http.get(`${BASE}/v1/agents`, () => {
        failCount += 1;
        if (failCount < 3) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'boom' } },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          data: [agent],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const listed = await c.listAgents();
    expect(listed.data).toHaveLength(1);
    expect(failCount).toBe(3);
  });

  it('connectStream wires handlers and delivers events', async () => {
    class FakeWS {
      static OPEN = 1;
      readyState = FakeWS.OPEN;
      listeners: Record<string, Array<(ev: unknown) => void>> = {};
      url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(type: string, cb: (ev: unknown) => void) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type]!.push(cb);
        if (type === 'open') queueMicrotask(() => cb({}));
      }
      close() {
        this.listeners['close']?.forEach((h) => h({}));
      }
    }

    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const c = makeClient();
    const seen: unknown[] = [];
    c.on('transaction.created', (p) => seen.push(p));
    const ws = c.connectStream();
    expect(ws).toBeInstanceOf(WebSocketClient);

    await Promise.resolve();
    const fake = (ws as unknown as { socket: InstanceType<typeof FakeWS> | null }).socket;
    expect(fake?.url).toContain('/v1/stream');
    fake?.listeners['message']?.forEach((h) =>
      h({
        data: JSON.stringify({ event: 'transaction.created', data: { id: '1' } }),
      }),
    );
    expect(seen).toHaveLength(1);

    fake?.listeners['close']?.forEach((h) => h({}));
    ws.close();
    vi.unstubAllGlobals();
  });

  it('WebSocketClient reconnects with backoff and emits exhausted', async () => {
    vi.useFakeTimers();
    let constructed = 0;
    class FlakyWS {
      static OPEN = 1;
      readyState = 0;
      listeners: Record<string, Array<(ev: unknown) => void>> = {};
      constructor(_url: string) {
        constructed += 1;
        queueMicrotask(() => this.listeners['close']?.forEach((h) => h({})));
      }
      addEventListener(type: string, cb: (ev: unknown) => void) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type]!.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FlakyWS as unknown as typeof WebSocket);

    const errors: unknown[] = [];
    const client = new WebSocketClient({
      apiKey: 'cs_live_test_key_123456',
      baseUrl: BASE,
      maxRetries: 2,
    });
    client.on('error', (e) => errors.push(e));
    client.connect();

    await vi.runAllTimersAsync();
    expect(constructed).toBeGreaterThan(1);
    expect(errors.some((e) => (e as { code?: string }).code === 'WS_RECONNECT_EXHAUSTED')).toBe(
      true,
    );

    client.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('WebSocketClient ignores malformed messages and supports off', () => {
    class FakeWS {
      listeners: Record<string, Array<(ev: unknown) => void>> = {};
      constructor(_url: string) {}
      addEventListener(type: string, cb: (ev: unknown) => void) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type]!.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const client = new WebSocketClient({
      apiKey: 'cs_live_test_key_123456',
      baseUrl: BASE,
    });
    const handler = vi.fn();
    client.on('message', handler);
    client.connect();
    const fake = (client as unknown as { socket: InstanceType<typeof FakeWS> }).socket;
    fake.listeners['message']?.forEach((h) => h({ data: 'not-json' }));
    expect(handler).not.toHaveBeenCalled();
    client.off('message', handler);
    client.close();
    vi.unstubAllGlobals();
  });

  it('throws when WebSocket is unavailable', () => {
    const prev = globalThis.WebSocket;
    // @ts-expect-error intentional
    delete globalThis.WebSocket;
    const client = new WebSocketClient({
      apiKey: 'cs_live_test_key_123456',
      baseUrl: BASE,
    });
    expect(() => client.connect()).toThrow(/WebSocket is not available/);
    globalThis.WebSocket = prev;
  });

  it('rejects short api keys', () => {
    expect(() => new CogniStreamClient({ apiKey: 'short' })).toThrow(/apiKey/i);
  });
});
