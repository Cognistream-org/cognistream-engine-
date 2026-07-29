import { z } from 'zod';
import { OrganizationTierSchema } from './organization.js';

export const BillingCycleSchema = z.enum(['monthly', 'yearly']);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

export const CheckoutBodySchema = z.object({
  tier: OrganizationTierSchema.exclude(['free']),
  cycle: BillingCycleSchema.default('monthly'),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});
export type CheckoutBody = z.infer<typeof CheckoutBodySchema>;

export const PortalQuerySchema = z.object({
  returnUrl: z.string().url(),
});
export type PortalQuery = z.infer<typeof PortalQuerySchema>;

export const ChangeTierBodySchema = z.object({
  tier: OrganizationTierSchema,
  cycle: BillingCycleSchema.optional(),
});
export type ChangeTierBody = z.infer<typeof ChangeTierBodySchema>;

export const ListInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;

export const InvoiceIdParamsSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'must be a UUID',
    ),
});

export const CreateConnectAccountBodySchema = z.object({
  country: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toLowerCase()),
});
export type CreateConnectAccountBody = z.infer<typeof CreateConnectAccountBodySchema>;

export const ConnectOnboardingBodySchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});
export type ConnectOnboardingBody = z.infer<typeof ConnectOnboardingBodySchema>;

export const SubscriptionResponseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  tier: OrganizationTierSchema,
  status: z.string(),
  stripeSubscriptionId: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  trialEndsAt: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;

export const InvoiceResponseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  subscriptionId: z.string().nullable(),
  stripeInvoiceId: z.string().nullable(),
  invoiceNumber: z.string(),
  status: z.string(),
  amountDueCents: z.string(),
  amountPaidCents: z.string(),
  currency: z.string(),
  pdfUrl: z.string().nullable(),
  hostedUrl: z.string().nullable(),
  dueDate: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  lineItems: z.unknown(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InvoiceResponse = z.infer<typeof InvoiceResponseSchema>;

export const StripeConnectAccountResponseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  stripeAccountId: z.string(),
  status: z.string(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  onboardingUrl: z.string().nullable(),
  onboardingUrlExpiresAt: z.string().datetime().nullable(),
  defaultCurrency: z.string(),
  country: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StripeConnectAccountResponse = z.infer<typeof StripeConnectAccountResponseSchema>;
