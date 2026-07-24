import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  toAgentResponse,
  toApiKeyMetadata,
  toCreatedApiKey,
  toEscrowResponse,
  toReputationSummary,
  toTransactionResponse,
} from './serializers.js';

describe('serializers', () => {
  it('serializes agents and api keys', () => {
    const agent = toAgentResponse({
      id: '1',
      orgId: 'o',
      name: 'n',
      publicKey: 'pk',
      capabilities: [],
      pricingModel: null,
      unitPriceCents: 10n,
      reputationScore: new Prisma.Decimal('0.5000'),
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(agent.unitPriceCents).toBe('10');
    expect(agent.reputationScore).toBe('0.5000');

    const key = {
      id: 'k',
      orgId: 'o',
      name: 'n',
      keyPrefix: 'cs_live_xxxxxx',
      keyHash: 'hash',
      scopes: ['read:agents'],
      lastUsedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
      revokedAt: null,
    };
    expect(toApiKeyMetadata(key).name).toBe('n');
    expect(toCreatedApiKey(key, 'cs_live_x').key).toBe('cs_live_x');
  });

  it('serializes reputation summary', () => {
    const summary = toReputationSummary(new Prisma.Decimal('0.7500'), [
      {
        id: 'e1',
        eventType: 'settle',
        delta: new Prisma.Decimal('0.0100'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    expect(summary.score).toBe('0.7500');
    expect(summary.recentEvents[0]?.delta).toBe('0.0100');
  });

  it('serializes transactions and escrow without balances', () => {
    const escrow = toEscrowResponse({
      id: 'e',
      transactionId: 't',
      amountCents: 100n,
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      released: false,
      releasedAt: null,
    });
    expect(escrow.amountCents).toBe('100');

    const tx = toTransactionResponse({
      id: 't',
      buyerId: 'b',
      sellerId: 's',
      amountCents: 1000n,
      feeCents: 5n,
      description: null,
      metadata: {},
      status: 'escrowed',
      idempotencyKey: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      settledAt: null,
      escrow: {
        id: 'e',
        transactionId: 't',
        amountCents: 1000n,
        expiresAt: new Date('2026-01-02T00:00:00.000Z'),
        released: false,
        releasedAt: null,
      },
      buyer: {
        id: 'b',
        orgId: 'o',
        name: 'buyer',
        publicKey: 'pkb',
        reputationScore: new Prisma.Decimal('0.5'),
        status: 'active',
      },
      seller: {
        id: 's',
        orgId: 'o2',
        name: 'seller',
        publicKey: 'pks',
        reputationScore: new Prisma.Decimal('0.6'),
        status: 'active',
      },
    });
    expect(tx.feeCents).toBe('5');
    expect(JSON.stringify(tx)).not.toMatch(/balance/i);
  });
});
