import type { FastifyPluginAsync } from 'fastify';
import {
  ChangeTierBodySchema,
  CheckoutBodySchema,
  InvoiceIdParamsSchema,
  ListInvoicesQuerySchema,
  PortalQuerySchema,
} from '@cognistream/shared';
import { forbidden, parseOrReply } from '../lib/http.js';
import {
  toInvoiceResponse,
  toSubscriptionResponse,
} from '../lib/serializers.js';
import {
  BillingNotFoundError,
  BillingConflictError,
  BillingStripeError,
  cancelSubscription,
  changeTier,
  createCheckoutSession,
  createPortalSession,
  getBillingProfile,
  getInvoice,
  getLimits,
  getSubscription,
  getUsageSummary,
  listInvoices,
} from '../services/billing.js';
import { AppError } from '../lib/errors.js';

function isBillingAppError(error: unknown): error is AppError {
  return (
    error instanceof BillingNotFoundError ||
    error instanceof BillingConflictError ||
    error instanceof BillingStripeError ||
    error instanceof AppError
  );
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/billing/profile',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const profile = await getBillingProfile(request.auth.orgId, { requestId });
        return reply.send({
          organization: {
            id: profile.organization.id,
            name: profile.organization.name,
            slug: profile.organization.slug,
            tier: profile.organization.tier,
            balanceCents: profile.organization.balanceCents.toString(),
          },
          subscription: profile.subscription
            ? toSubscriptionResponse(profile.subscription)
            : null,
          pricing: profile.pricing,
        });
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.post(
    '/billing/checkout',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(CheckoutBodySchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      try {
        const session = await createCheckoutSession(
          request.auth.orgId,
          body.tier,
          body.cycle,
          body.successUrl,
          body.cancelUrl,
          { requestId },
        );
        return reply.send({ url: session.url, sessionId: session.sessionId });
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/billing/portal',
    {
      preHandler: [
        async (request, reply) => {
          await app.authenticate(request, reply);
          if (reply.sent) {
            return;
          }
          const scopes = request.auth?.scopes ?? [];
          if (!scopes.includes('write:billing') && !scopes.includes('read:billing')) {
            forbidden(
              reply,
              String(request.id),
              'Missing required scope(s): read:billing or write:billing',
            );
          }
        },
      ],
    },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(PortalQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) {
        return;
      }

      try {
        const url = await createPortalSession(request.auth.orgId, query.returnUrl, {
          requestId,
        });
        return reply.send({ url });
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/billing/subscription',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const subscription = await getSubscription(request.auth.orgId, { requestId });
        if (!subscription) {
          throw new BillingNotFoundError('Subscription not found', requestId);
        }
        return reply.send(toSubscriptionResponse(subscription));
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.patch(
    '/billing/subscription',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(ChangeTierBodySchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      try {
        const subscription = await changeTier(request.auth.orgId, body.tier, {
          requestId,
          cycle: body.cycle,
        });
        return reply.send(toSubscriptionResponse(subscription));
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.delete(
    '/billing/subscription',
    { preHandler: [app.requireScopes('write:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const subscription = await cancelSubscription(request.auth.orgId, { requestId });
        return reply.send(toSubscriptionResponse(subscription));
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/billing/invoices',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(ListInvoicesQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) {
        return;
      }

      const result = await listInvoices(request.auth.orgId, query);
      return reply.send({
        data: result.items.map(toInvoiceResponse),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    },
  );

  app.get(
    '/billing/invoices/:id',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(InvoiceIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      try {
        const invoice = await getInvoice(request.auth.orgId, params.id, requestId);
        return reply.send(toInvoiceResponse(invoice));
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/billing/usage',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const usage = await getUsageSummary(request.auth.orgId, {
          requestId,
          redis: app.redis,
        });
        return reply.send(usage);
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );

  app.get(
    '/billing/limits',
    { preHandler: [app.requireScopes('read:billing')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      try {
        const limits = await getLimits(request.auth.orgId, {
          requestId,
          redis: app.redis,
        });
        return reply.send(limits);
      } catch (error) {
        if (isBillingAppError(error)) throw error;
        throw error;
      }
    },
  );
};
