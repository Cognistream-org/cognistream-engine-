import type { Prisma } from '@prisma/client';
import type { CreateApiKeyInput } from '@cognistream/shared';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { generateApiKey, hashApiKey } from '../lib/api-key.js';
import { AppError } from '../lib/errors.js';

export const apiKeySelect = {
  id: true,
  orgId: true,
  name: true,
  keyPrefix: true,
  keyHash: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

/** Fields safe to return in list/metadata responses (no secret material). */
export const apiKeyMetadataSelect = {
  id: true,
  orgId: true,
  name: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

export type ApiKeyRow = Prisma.ApiKeyGetPayload<{ select: typeof apiKeySelect }>;
export type ApiKeyMetadataRow = Prisma.ApiKeyGetPayload<{ select: typeof apiKeyMetadataSelect }>;

export class ApiKeyNotFoundError extends AppError {
  constructor(requestId = 'unknown') {
    super('API_KEY_NOT_FOUND', 'API key not found', 404, requestId);
    this.name = 'ApiKeyNotFoundError';
  }
}

export type ListApiKeysQuery = {
  page: number;
  limit: number;
};

export async function createApiKey(
  orgId: string,
  input: CreateApiKeyInput,
): Promise<{ record: ApiKeyRow; plaintext: string }> {
  const { key, keyPrefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  const expiresAt =
    input.expiresInDays === undefined
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  const record = await prisma.apiKey.create({
    data: {
      id: createId(),
      orgId,
      name: input.name,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      expiresAt,
    },
    select: apiKeySelect,
  });

  return { record, plaintext: key };
}

export async function listApiKeys(
  orgId: string,
  query: ListApiKeysQuery,
): Promise<{ items: ApiKeyMetadataRow[]; total: number; page: number; limit: number }> {
  const where: Prisma.ApiKeyWhereInput = { orgId };

  const [total, items] = await prisma.$transaction([
    prisma.apiKey.count({ where }),
    prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: apiKeyMetadataSelect,
    }),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function revokeApiKey(
  orgId: string,
  apiKeyId: string,
  requestId = 'unknown',
): Promise<ApiKeyMetadataRow> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, orgId, revokedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiKeyNotFoundError(requestId);
  }

  return prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { revokedAt: new Date() },
    select: apiKeyMetadataSelect,
  });
}
