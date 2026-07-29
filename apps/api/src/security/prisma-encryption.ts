import { Prisma } from '@prisma/client';
import type { EncryptionService } from './encryption.js';
import { isEncryptedPayload } from './encryption.js';

const ENCRYPTED_STRING_FIELDS = {
  webhook: ['secret'],
} as const;

const ENCRYPTED_JSON_FIELDS = {
  agent: ['metadata'],
} as const;

type MutationArgs = {
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
};

function encryptCreateData(
  encryption: EncryptionService,
  model: string,
  data: Record<string, unknown>,
): void {
  const stringFields =
    ENCRYPTED_STRING_FIELDS[model as keyof typeof ENCRYPTED_STRING_FIELDS] ?? [];
  for (const field of stringFields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      data[field] = encryption.encryptStringField(value);
    }
  }

  const jsonFields =
    ENCRYPTED_JSON_FIELDS[model as keyof typeof ENCRYPTED_JSON_FIELDS] ?? [];
  for (const field of jsonFields) {
    if (field in data && data[field] !== undefined) {
      const value = data[field];
      if (!isEncryptedPayload(value)) {
        data[field] = encryption.encryptJsonField(value);
      }
    }
  }
}

function encryptUpdateData(
  encryption: EncryptionService,
  model: string,
  data: Record<string, unknown>,
): void {
  encryptCreateData(encryption, model, data);
}

function decryptResult(
  encryption: EncryptionService,
  model: string,
  result: unknown,
): unknown {
  if (result === null || result === undefined) return result;
  if (Array.isArray(result)) {
    return result.map((row) => decryptResult(encryption, model, row));
  }
  if (typeof result !== 'object') return result;

  const row = result as Record<string, unknown>;

  const stringFields =
    ENCRYPTED_STRING_FIELDS[model as keyof typeof ENCRYPTED_STRING_FIELDS] ?? [];
  for (const field of stringFields) {
    if (typeof row[field] === 'string') {
      row[field] = encryption.decryptStringField(row[field] as string);
    }
  }

  const jsonFields =
    ENCRYPTED_JSON_FIELDS[model as keyof typeof ENCRYPTED_JSON_FIELDS] ?? [];
  for (const field of jsonFields) {
    if (field in row) {
      row[field] = encryption.decryptJsonField(row[field]);
    }
  }

  return row;
}

/**
 * Prisma client extension: auto-encrypt on write, auto-decrypt on read
 * for configured sensitive fields. Never logs plaintext.
 */
export function encryptionExtension(encryption: EncryptionService) {
  return Prisma.defineExtension({
    name: 'field-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          const mutArgs = args as MutationArgs;

          if (
            (operation === 'create' ||
              operation === 'createMany' ||
              operation === 'update' ||
              operation === 'updateMany' ||
              operation === 'upsert') &&
            mutArgs.data
          ) {
            if (Array.isArray(mutArgs.data)) {
              for (const row of mutArgs.data) {
                if (operation === 'create' || operation === 'createMany') {
                  encryptCreateData(encryption, modelKey, row);
                } else {
                  encryptUpdateData(encryption, modelKey, row);
                }
              }
            } else if (operation === 'upsert') {
              const upsertArgs = args as {
                create?: Record<string, unknown>;
                update?: Record<string, unknown>;
              };
              if (upsertArgs.create) {
                encryptCreateData(encryption, modelKey, upsertArgs.create);
              }
              if (upsertArgs.update) {
                encryptUpdateData(encryption, modelKey, upsertArgs.update);
              }
            } else {
              encryptCreateData(encryption, modelKey, mutArgs.data);
            }
          }

          const result = await query(args);

          const readOps = new Set([
            'findUnique',
            'findUniqueOrThrow',
            'findFirst',
            'findFirstOrThrow',
            'findMany',
            'create',
            'createManyAndReturn',
            'update',
            'upsert',
          ]);

          if (readOps.has(operation)) {
            return decryptResult(encryption, modelKey, result);
          }

          return result;
        },
      },
    },
  });
}
