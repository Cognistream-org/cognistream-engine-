import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createEncryptionService } from './encryption.js';
import { encryptionExtension } from './prisma-encryption.js';

type OpHandler = (args: {
  model: string;
  operation: string;
  args: Record<string, unknown>;
  query: (a: Record<string, unknown>) => Promise<unknown>;
}) => Promise<unknown>;

function getHandler(encryption = createEncryptionService(`u:${randomBytes(32).toString('base64')}`)): {
  encryption: ReturnType<typeof createEncryptionService>;
  handler: OpHandler;
  restore: () => void;
} {
  let handler: OpHandler | undefined;
  const spy = vi.spyOn(Prisma, 'defineExtension').mockImplementation(((ext: {
    query: { $allModels: { $allOperations: OpHandler } };
  }) => {
    handler = ext.query.$allModels.$allOperations;
    return ext as never;
  }) as never);

  encryptionExtension(encryption);
  if (!handler) {
    throw new Error('handler not captured');
  }
  return {
    encryption,
    handler,
    restore: () => {
      spy.mockRestore();
    },
  };
}

describe('encryptionExtension (unit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts webhook.secret on create and decrypts on findUnique', async () => {
    const { encryption, handler, restore } = getHandler();
    try {
      const args = { data: { secret: 'whsec_plain', url: 'https://x.test' } };
      const stored = await handler({
        model: 'Webhook',
        operation: 'create',
        args,
        query: async (a) => {
          const data = (a as { data: { secret: string } }).data;
          expect(data.secret).not.toBe('whsec_plain');
          expect(data.secret).toContain('ciphertext');
          return { id: '1', secret: data.secret };
        },
      });
      expect((stored as { secret: string }).secret).toBe('whsec_plain');

      // ensure encryption service primary key is reachable
      expect(encryption.primaryKey).toBe('u');
    } finally {
      restore();
    }
  });

  it('encrypts agent.metadata on update and passes through unrelated models', async () => {
    const { handler, restore } = getHandler();
    try {
      const meta = { email: 'a@b.co' };
      const result = await handler({
        model: 'Agent',
        operation: 'update',
        args: { data: { metadata: meta } },
        query: async (a) => {
          const data = (a as { data: { metadata: unknown } }).data;
          expect(data.metadata).toMatchObject({ ciphertext: expect.any(String) });
          return { id: 'a1', metadata: data.metadata };
        },
      });
      expect((result as { metadata: unknown }).metadata).toEqual(meta);

      const passthrough = await handler({
        model: 'Organization',
        operation: 'create',
        args: { data: { name: 'Org' } },
        query: async (a) => a,
      });
      expect(passthrough).toEqual({ data: { name: 'Org' } });
    } finally {
      restore();
    }
  });

  it('handles createMany arrays and upsert create/update', async () => {
    const { handler, restore } = getHandler();
    try {
      await handler({
        model: 'Webhook',
        operation: 'createMany',
        args: { data: [{ secret: 'a' }, { secret: 'b' }] },
        query: async (a) => {
          const rows = (a as { data: Array<{ secret: string }> }).data;
          expect(rows[0]!.secret).toContain('ciphertext');
          expect(rows[1]!.secret).toContain('ciphertext');
          return { count: 2 };
        },
      });

      await handler({
        model: 'Webhook',
        operation: 'upsert',
        args: {
          create: { secret: 'create-secret' },
          update: { secret: 'update-secret' },
        },
        query: async (a) => {
          const upsert = a as { create: { secret: string }; update: { secret: string } };
          expect(upsert.create.secret).toContain('ciphertext');
          expect(upsert.update.secret).toContain('ciphertext');
          return { id: '1', secret: upsert.create.secret };
        },
      });
      await handler({
        model: 'Webhook',
        operation: 'updateMany',
        args: { data: [{ secret: 'u1' }, { secret: 'u2' }] },
        query: async (a) => {
          const rows = (a as { data: Array<{ secret: string }> }).data;
          expect(rows[0]!.secret).toContain('ciphertext');
          expect(rows[1]!.secret).toContain('ciphertext');
          return { count: 2 };
        },
      });
    } finally {
      restore();
    }
  });

  it('decrypts findMany arrays and leaves null alone; skips non-read ops', async () => {
    const { encryption, handler, restore } = getHandler();
    try {
      const envelope = encryption.encryptStringField('s');
      const rows = await handler({
        model: 'Webhook',
        operation: 'findMany',
        args: {},
        query: async () => [{ secret: envelope }, { secret: 'legacy' }, null],
      });
      expect(rows).toEqual([{ secret: 's' }, { secret: 'legacy' }, null]);

      await expect(
        handler({
          model: 'Webhook',
          operation: 'deleteMany',
          args: {},
          query: async () => ({ count: 0 }),
        }),
      ).resolves.toEqual({ count: 0 });

      await expect(
        handler({
          model: 'Webhook',
          operation: 'findFirst',
          args: {},
          query: async () => null,
        }),
      ).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it('skips empty secrets and already-encrypted metadata', async () => {
    const { encryption, handler, restore } = getHandler();
    try {
      const already = encryption.encryptJsonField({ x: 1 });
      await handler({
        model: 'Agent',
        operation: 'create',
        args: { data: { metadata: already } },
        query: async (a) => {
          expect((a as { data: { metadata: unknown } }).data.metadata).toBe(already);
          return { metadata: already };
        },
      });

      await handler({
        model: 'Webhook',
        operation: 'create',
        args: { data: { secret: '' } },
        query: async (a) => {
          expect((a as { data: { secret: string } }).data.secret).toBe('');
          return { secret: '' };
        },
      });
    } finally {
      restore();
    }
  });

  it('decrypts scalar non-object results unchanged', async () => {
    const { handler, restore } = getHandler();
    try {
      await expect(
        handler({
          model: 'Webhook',
          operation: 'findUnique',
          args: {},
          query: async () => 42,
        }),
      ).resolves.toBe(42);
    } finally {
      restore();
    }
  });
});
