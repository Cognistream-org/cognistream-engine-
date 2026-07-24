import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  toAgentResponse,
  toApiKeyMetadata,
  toCreatedApiKey,
  toReputationSummary,
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
});
