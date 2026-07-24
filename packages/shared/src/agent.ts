import { z } from 'zod';

export const AgentStatusSchema = z.enum(['active', 'inactive', 'suspended']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(128),
  publicKey: z.string().min(16).max(4096),
  capabilities: z.array(z.string().min(1).max(64)).max(50).default([]),
  pricingModel: z.string().min(1).max(32).optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

export const ListAgentsQuerySchema = z.object({
  capability: z.string().min(1).max(64).optional(),
  status: AgentStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAgentsQuery = z.infer<typeof ListAgentsQuerySchema>;

export const AgentIdParamsSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'must be a UUID',
    ),
});

export const AgentResponseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  publicKey: z.string(),
  capabilities: z.array(z.string()),
  pricingModel: z.string().nullable(),
  unitPriceCents: z.string().nullable(),
  reputationScore: z.string(),
  status: AgentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
