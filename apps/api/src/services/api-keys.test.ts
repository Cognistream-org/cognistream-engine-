import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/api-key.js', () => ({
  generateApiKey: vi.fn(() => ({ key: 'cs_live_testkey', keyPrefix: 'cs_live_testke' })),
  hashApiKey: vi.fn(async () => 'hashed'),
}));

import { prisma } from '../lib/prisma.js';
import {
  ApiKeyNotFoundError,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from './api-keys.js';

const baseKey = {
  id: '01900000-0000-7000-8000-0000000000bb',
  orgId: '01900000-0000-7000-8000-0000000000aa',
  name: 'root',
  keyPrefix: 'cs_live_testke',
  keyHash: 'hashed',
  scopes: ['read:agents'],
  lastUsedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  revokedAt: null,
};

describe('api-keys service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createApiKey returns plaintext once', async () => {
    vi.mocked(prisma.apiKey.create).mockResolvedValue(baseKey as never);
    const result = await createApiKey(baseKey.orgId, {
      name: 'root',
      scopes: ['read:agents'],
    });
    expect(result.plaintext).toBe('cs_live_testkey');
    expect(result.record.id).toBe(baseKey.id);
  });

  it('listApiKeys paginates', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [baseKey]]);
    const result = await listApiKeys(baseKey.orgId, { page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]?.name).toBe('root');
  });

  it('revokeApiKey soft-deletes', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({ id: baseKey.id } as never);
    vi.mocked(prisma.apiKey.update).mockResolvedValue({
      ...baseKey,
      revokedAt: new Date('2026-01-02T00:00:00.000Z'),
    } as never);
    const result = await revokeApiKey(baseKey.orgId, baseKey.id);
    expect(result.revokedAt).toBeTruthy();
  });

  it('revokeApiKey throws when missing', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
    await expect(revokeApiKey(baseKey.orgId, baseKey.id)).rejects.toBeInstanceOf(
      ApiKeyNotFoundError,
    );
  });
});
