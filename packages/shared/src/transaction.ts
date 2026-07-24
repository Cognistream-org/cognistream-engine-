import { z } from 'zod';

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'must be a UUID',
  );

export const TransactionStatusSchema = z.enum([
  'pending',
  'escrowed',
  'settled',
  'disputed',
  'refunded',
  'failed',
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const CreateTransactionSchema = z.object({
  sellerId: UuidSchema,
  amountCents: z.number().int().positive(),
  description: z.string().max(512).optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(64).optional(),
});
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;

export const ReleaseEscrowSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  review: z.string().max(1000).optional(),
});
export type ReleaseEscrowInput = z.infer<typeof ReleaseEscrowSchema>;

export const TransactionIdParamsSchema = z.object({
  id: UuidSchema,
});

export const ListTransactionsQuerySchema = z.object({
  buyerId: UuidSchema.optional(),
  sellerId: UuidSchema.optional(),
  status: TransactionStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;

export const EscrowResponseSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  amountCents: z.string(),
  expiresAt: z.string().datetime(),
  released: z.boolean(),
  releasedAt: z.string().datetime().nullable(),
});
export type EscrowResponse = z.infer<typeof EscrowResponseSchema>;

export const TransactionAgentSummarySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  publicKey: z.string(),
  reputationScore: z.string(),
  status: z.string(),
});
export type TransactionAgentSummary = z.infer<typeof TransactionAgentSummarySchema>;

export const TransactionResponseSchema = z.object({
  id: z.string(),
  buyerId: z.string(),
  sellerId: z.string(),
  amountCents: z.string(),
  feeCents: z.string(),
  description: z.string().nullable(),
  metadata: z.unknown().nullable(),
  status: TransactionStatusSchema,
  idempotencyKey: z.string().nullable(),
  createdAt: z.string().datetime(),
  settledAt: z.string().datetime().nullable(),
  escrow: EscrowResponseSchema.nullable().optional(),
  buyer: TransactionAgentSummarySchema.optional(),
  seller: TransactionAgentSummarySchema.optional(),
});
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;
