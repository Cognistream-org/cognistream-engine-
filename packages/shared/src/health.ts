import { z } from 'zod';

export const ServiceStatusSchema = z.enum(['up', 'down']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const HealthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  services: z.object({
    database: ServiceStatusSchema,
    redis: ServiceStatusSchema,
  }),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
