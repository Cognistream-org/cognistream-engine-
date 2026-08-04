import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Billing API' };

const endpoints = [
  {
    method: 'GET',
    path: '/v1/billing/profile',
    description: 'Organization tier, subscription, and pricing config for the authenticated org.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/profile HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "organization": {
    "id": "01932a1a-...",
    "name": "Acme AI",
    "slug": "acme-ai",
    "tier": "developer",
    "balanceCents": "100000"
  },
  "subscription": {
    "id": "01932a1c-...",
    "tier": "developer",
    "status": "active",
    "cancelAtPeriodEnd": false
  },
  "pricing": {
    "name": "Developer",
    "monthlyPriceCents": 4900,
    "platformFeeBasisPoints": 250
  }
}`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'FORBIDDEN', status: 403, description: 'Insufficient scopes' },
      { code: 'RATE_LIMITED', status: 429, description: 'Too many requests' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/billing/checkout',
    description: 'Create a Stripe Checkout session to upgrade to Developer or Enterprise.',
    scopes: ['write:billing'],
    requestExample: `POST /v1/billing/checkout HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: checkout-001
Content-Type: application/json

{
  "tier": "developer",
  "cycle": "monthly",
  "successUrl": "https://app.example.com/billing/success",
  "cancelUrl": "https://app.example.com/billing/cancel"
}`,
    responseExample: `HTTP/1.1 200 OK

{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid body (tier cannot be free)' },
      { code: 'BILLING_CONFLICT', status: 409, description: 'Checkout not allowed in current state' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'RATE_LIMITED', status: 429, description: 'Too many requests' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/portal',
    description: 'Open the Stripe Customer Portal for payment methods and invoices.',
    scopes: ['read:billing', 'write:billing'],
    requestExample: `GET /v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example.com%2Fbilling HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{ "url": "https://billing.stripe.com/p/session/..." }`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'returnUrl required' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'FORBIDDEN', status: 403, description: 'Missing billing scopes' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/subscription',
    description: 'Get the current organization subscription.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/subscription HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "id": "01932a1c-...",
  "orgId": "01932a1a-...",
  "tier": "developer",
  "status": "active",
  "currentPeriodStart": "2026-07-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-08-01T00:00:00.000Z",
  "cancelAtPeriodEnd": false
}`,
    errorCodes: [
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Subscription not found' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'PATCH',
    path: '/v1/billing/subscription',
    description: 'Change subscription tier (and optional billing cycle).',
    scopes: ['write:billing'],
    requestExample: `PATCH /v1/billing/subscription HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: tier-001
Content-Type: application/json

{ "tier": "enterprise", "cycle": "yearly" }`,
    responseExample: `HTTP/1.1 200 OK

{ "id": "01932a1c-...", "tier": "enterprise", "status": "active" }`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid tier or cycle' },
      { code: 'BILLING_CONFLICT', status: 409, description: 'Tier change not allowed' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'DELETE',
    path: '/v1/billing/subscription',
    description: 'Cancel the subscription (typically at period end).',
    scopes: ['write:billing'],
    requestExample: `DELETE /v1/billing/subscription HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: cancel-001`,
    responseExample: `HTTP/1.1 200 OK

{ "id": "01932a1c-...", "status": "active", "cancelAtPeriodEnd": true }`,
    errorCodes: [
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Subscription not found' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/invoices',
    description: 'List invoices with pagination.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/invoices?page=1&limit=20 HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "data": [{
    "id": "01932a1d-...",
    "invoiceNumber": "INV-001",
    "status": "paid",
    "amountDueCents": "4900",
    "amountPaidCents": "4900",
    "currency": "usd"
  }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid query parameters' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/invoices/:id',
    description: 'Get a single invoice by UUID.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/invoices/01932a1d-... HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "id": "01932a1d-...",
  "invoiceNumber": "INV-001",
  "status": "paid",
  "amountDueCents": "4900",
  "pdfUrl": "https://pay.stripe.com/invoice/.../pdf",
  "hostedUrl": "https://invoice.stripe.com/i/..."
}`,
    errorCodes: [
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Invoice not in organization' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/usage',
    description: 'Current billing-period usage meters versus soft and hard limits.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/usage HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "orgId": "01932a1a-...",
  "billingPeriod": "2026-07",
  "tier": "developer",
  "meters": {
    "api_calls": { "usage": 120, "limit": 10000, "hardLimit": 12000 },
    "transactions": { "usage": 15, "limit": 1000, "hardLimit": 1200 },
    "transaction_volume_cents": { "usage": 50000, "limit": 50000000, "hardLimit": 60000000 }
  }
}`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'RATE_LIMITED', status: 429, description: 'Too many requests' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/billing/limits',
    description: 'Plan limits, current usage, and soft/hard limit ratios.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/billing/limits HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "tier": "developer",
  "limits": {
    "apiCallsPerMonth": 10000,
    "transactionsPerMonth": 1000,
    "agents": 10
  },
  "usage": {
    "api_calls": { "usage": 120, "limit": 10000, "hardLimit": 12000 }
  },
  "softLimitRatio": 0.8,
  "hardLimitRatio": 1.2
}`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'RATE_LIMITED', status: 429, description: 'Too many requests' },
    ],
  },
];

export default function BillingApiPage() {
  return (
    <DocPage title="Billing API">
      <p>
        Manage subscriptions, Stripe Checkout, Customer Portal, invoices, and usage quotas. Monetary
        amounts are integer cents (strings in JSON). Soft warnings fire at 80% of quota; Free hard
        blocks at 100%, paid tiers at 120%.
      </p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
