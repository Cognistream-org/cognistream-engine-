import { z } from 'zod';

export const ApiKeyScopeSchema = z.enum([
  'read:agents',
  'write:agents',
  'read:transactions',
  'write:transactions',
  'read:billing',
  'write:billing',
  'admin:keys',
  'admin:disputes',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z
    .array(ApiKeyScopeSchema)
    .min(1)
    .default(['read:agents', 'read:transactions', 'write:transactions']),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export const ApiKeyIdParamsSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'must be a UUID',
    ),
});

export const ApiKeyMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type ApiKeyMetadata = z.infer<typeof ApiKeyMetadataSchema>;

export const CreatedApiKeySchema = ApiKeyMetadataSchema.extend({
  key: z.string(),
});
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;
