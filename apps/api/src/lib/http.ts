import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z, ZodTypeAny } from 'zod';
import { errorBody } from './errors.js';

export function parseOrReply<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
  reply: FastifyReply,
  requestId: string,
): z.infer<S> | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    void reply.status(422).send(
      errorBody('VALIDATION_ERROR', 'Validation failed', requestId, details),
    );
    return null;
  }
  return parsed.data as z.infer<S>;
}

export function unauthorized(reply: FastifyReply, requestId: string, message = 'Missing or invalid API key'): void {
  void reply.status(401).send(errorBody('UNAUTHORIZED', message, requestId));
}

export function forbidden(reply: FastifyReply, requestId: string, message: string): void {
  void reply.status(403).send(errorBody('FORBIDDEN', message, requestId));
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.auth) {
    unauthorized(reply, String(request.id));
    return false;
  }
  return true;
}
