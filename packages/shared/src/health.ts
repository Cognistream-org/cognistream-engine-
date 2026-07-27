import { z } from 'zod';

export const ServiceStatusSchema = z.enum(['up', 'down']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

/** Per-dependency check with optional latency. */
export const HealthDependencyCheckSchema = z.object({
  status: ServiceStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
});
export type HealthDependencyCheck = z.infer<typeof HealthDependencyCheckSchema>;

/**
 * Health check response (v2).
 * - /health (liveness): fast, no dependency checks
 * - /health/ready: DB + Redis
 * - /health/deep: DB query + Redis ping + disk, max 5s
 */
export const HealthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  checks: z
    .object({
      database: HealthDependencyCheckSchema.optional(),
      redis: HealthDependencyCheckSchema.optional(),
      disk: HealthDependencyCheckSchema.optional(),
    })
    .default({}),
  version: z.string(),
  uptime: z.number().nonnegative(),
  timestamp: z.string().datetime().optional(),
  /** @deprecated Prefer `checks.*.status`. Kept for older clients during transition. */
  services: z
    .object({
      database: ServiceStatusSchema,
      redis: ServiceStatusSchema,
    })
    .optional(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
