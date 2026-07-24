import { z } from 'zod';

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'must be a UUID',
  );

export const DisputeStatusSchema = z.enum([
  'open',
  'under_review',
  'resolved_buyer',
  'resolved_seller',
  'closed',
]);
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;

export const CreateDisputeSchema = z.object({
  reason: z.string().min(1).max(512),
});
export type CreateDisputeInput = z.infer<typeof CreateDisputeSchema>;

export const ResolveDisputeSchema = z.object({
  resolution: z.enum(['buyer', 'seller']),
  notes: z.string().max(1024).optional(),
});
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeSchema>;

export const DisputeIdParamsSchema = z.object({
  id: UuidSchema,
});

export const ListDisputesQuerySchema = z.object({
  status: DisputeStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListDisputesQuery = z.infer<typeof ListDisputesQuerySchema>;

export const DisputeResponseSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  raisedById: z.string(),
  reason: z.string(),
  status: DisputeStatusSchema,
  resolution: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DisputeResponse = z.infer<typeof DisputeResponseSchema>;
