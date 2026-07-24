import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { AppError, errorBody } from './errors.js';

function requestIdOf(request: FastifyRequest): string {
  return String(request.id);
}

function isPrismaKnownRequestError(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return (
    typeof err === 'object' &&
    err !== null &&
    err instanceof Prisma.PrismaClientKnownRequestError
  );
}

export function handleError(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = requestIdOf(request);

  if (reply.sent) {
    return;
  }

  if (err instanceof AppError) {
    void reply.status(err.statusCode).send(
      errorBody(err.code, err.message, err.requestId || requestId, err.details),
    );
    return;
  }

  if (isPrismaKnownRequestError(err)) {
    if (err.code === 'P2002') {
      void reply.status(409).send(errorBody('CONFLICT', 'Resource already exists', requestId));
      return;
    }
    if (err.code === 'P2025') {
      void reply.status(404).send(errorBody('NOT_FOUND', 'Resource not found', requestId));
      return;
    }
  }

  const statusCode =
    'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;

  if (statusCode >= 400 && statusCode < 500) {
    void reply.status(statusCode).send(
      errorBody('REQUEST_ERROR', err.message || 'Request error', requestId),
    );
    return;
  }

  request.log.error({ err }, 'Unhandled error');
  void reply.status(500).send(errorBody('INTERNAL_ERROR', 'Internal server error', requestId));
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    handleError(err, request, reply);
  });
}
