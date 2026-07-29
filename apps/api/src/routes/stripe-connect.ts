import type { FastifyPluginAsync } from 'fastify';
import {
  ConnectOnboardingBodySchema,
  CreateConnectAccountBodySchema,
} from '@cognistream/shared';
import { parseOrReply } from '../lib/http.js';
import { toStripeConnectAccountResponse } from '../lib/serializers.js';
import { AppError } from '../lib/errors.js';
import {
  StripeConnectConflictError,
  StripeConnectError,
  StripeConnectNotFoundError,
  createAccount,
  createOnboardingLink,
  disconnectAccount,
  getConnectAccount,
} from '../services/stripe-connect.js';

function isConnectAppError(error: unknown): error is AppError {
  return (
    error instanceof StripeConnectConflictError ||
    error instanceof StripeConnectNotFoundError ||
    error instanceof StripeConnectError ||
    error instanceof AppError
  );
}

export const stripeConnectRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/stripe/connect',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(CreateConnectAccountBodySchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      try {
        const account = await createAccount(request.auth.orgId, body.country, { requestId });
        return reply.status(201).send(toStripeConnectAccountResponse(account));
      } catch (error) {
        if (isConnectAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/stripe/connect',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const account = await getConnectAccount(request.auth.orgId, { requestId });
        return reply.send(toStripeConnectAccountResponse(account));
      } catch (error) {
        if (isConnectAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.post(
    '/stripe/connect/onboarding',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(ConnectOnboardingBodySchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      try {
        const account = await getConnectAccount(request.auth.orgId, { requestId });
        const url = await createOnboardingLink(
          account.id,
          body.returnUrl,
          body.refreshUrl,
          { requestId },
        );
        return reply.send({ url });
      } catch (error) {
        if (isConnectAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.delete(
    '/stripe/connect',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        await disconnectAccount(request.auth.orgId, { requestId });
        return reply.status(204).send();
      } catch (error) {
        if (isConnectAppError(error)) throw error;
        throw error;
      }
    },
  );
};
