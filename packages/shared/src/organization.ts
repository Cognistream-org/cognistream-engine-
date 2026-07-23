import { z } from 'zod';

export const OrganizationTierSchema = z.enum(['free', 'developer', 'enterprise']);
export type OrganizationTier = z.infer<typeof OrganizationTierSchema>;

export const OrganizationSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'must be a UUID v7',
    ),
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
  tier: OrganizationTierSchema,
  balanceCents: z.bigint(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
  tier: OrganizationTierSchema.default('free'),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
