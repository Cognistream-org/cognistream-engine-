import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signWebhookPayload, dispatchEvent } from './webhooks.js';
import { prisma } from '../lib/prisma.js';
import { resetCircuitBreakers } from '../resilience/circuit-breaker.js';

describe('signWebhookPayload', () => {
  it('produces sha256=<hex> HMAC signature', () => {
    const payload = '{"event":"transaction.created"}';
    const secret = 'whsec_test_secret';
    const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(signWebhookPayload(payload, secret)).toBe(expected);
  });

  it('changes when payload or secret changes', () => {
    const a = signWebhookPayload('a', 'secret');
    const b = signWebhookPayload('b', 'secret');
    const c = signWebhookPayload('a', 'other');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('dispatchEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetCircuitBreakers();
  });

  it('no-ops when no webhooks match', async () => {
    vi.spyOn(prisma.webhook, 'findMany').mockResolvedValue([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await dispatchEvent('org-1', 'transaction.created', { id: 'tx-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs signed payload to matching webhooks', async () => {
    vi.spyOn(prisma.webhook, 'findMany').mockResolvedValue([
      {
        id: 'hook-1',
        url: 'https://example.com/hooks',
        secret: 'whsec_abc',
      },
    ] as never);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    await dispatchEvent('org-1', 'transaction.settled', { transactionId: 'tx-1' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://example.com/hooks');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-CogniStream-Signature']).toMatch(/^sha256=[0-9a-f]+$/);
    const body = String(init?.body);
    expect(JSON.parse(body).event).toBe('transaction.settled');
  });

  it('retries on non-OK responses then succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma.webhook, 'findMany').mockResolvedValue([
      { id: 'hook-1', url: 'https://example.com/hooks', secret: 's' },
    ] as never);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const done = dispatchEvent('org-1', 'escrow.released', { id: 'e1' });
    await vi.runAllTimersAsync();
    await done;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries on network errors', async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma.webhook, 'findMany').mockResolvedValue([
      { id: 'hook-1', url: 'https://example.com/hooks', secret: 's' },
    ] as never);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const done = dispatchEvent('org-1', 'reputation.changed', { agentId: 'a1' });
    await vi.runAllTimersAsync();
    await done;

    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
