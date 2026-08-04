import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Stripe Connect API' };

const endpoints = [
  {
    method: 'POST',
    path: '/v1/stripe/connect',
    description:
      'Create a Stripe Connect Express account for seller payouts (Developer/Enterprise).',
    scopes: ['write:billing'],
    requestExample: `POST /v1/stripe/connect HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: connect-001
Content-Type: application/json

{ "country": "us" }`,
    responseExample: `HTTP/1.1 200 OK

{
  "id": "01932a1e-...",
  "orgId": "01932a1a-...",
  "stripeAccountId": "acct_...",
  "status": "pending",
  "chargesEnabled": false,
  "payoutsEnabled": false,
  "country": "us",
  "defaultCurrency": "usd",
  "onboardingUrl": null
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'country must be ISO-2' },
      { code: 'BILLING_CONFLICT', status: 409, description: 'Connect account already exists' },
      { code: 'FORBIDDEN', status: 403, description: 'Tier does not include Stripe Connect' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/stripe/connect',
    description: 'Get Connect account status and capabilities.',
    scopes: ['read:billing'],
    requestExample: `GET /v1/stripe/connect HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "id": "01932a1e-...",
  "stripeAccountId": "acct_...",
  "status": "active",
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "country": "us"
}`,
    errorCodes: [
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Connect account not found' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/stripe/connect/onboarding',
    description: 'Create a Stripe Account Link for KYC onboarding.',
    scopes: ['write:billing'],
    requestExample: `POST /v1/stripe/connect/onboarding HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: onboard-001
Content-Type: application/json

{
  "returnUrl": "https://app.example.com/billing/connect",
  "refreshUrl": "https://app.example.com/billing/connect/refresh"
}`,
    responseExample: `HTTP/1.1 200 OK

{ "url": "https://connect.stripe.com/setup/s/..." }`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'returnUrl and refreshUrl required' },
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Connect account not found' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'DELETE',
    path: '/v1/stripe/connect',
    description: 'Disconnect the Stripe Connect account from the organization.',
    scopes: ['write:billing'],
    requestExample: `DELETE /v1/stripe/connect HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Idempotency-Key: disconnect-001`,
    responseExample: `HTTP/1.1 204 No Content`,
    errorCodes: [
      { code: 'BILLING_NOT_FOUND', status: 404, description: 'Connect account not found' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'FORBIDDEN', status: 403, description: 'Insufficient scopes' },
    ],
  },
];

export default function StripeConnectApiPage() {
  return (
    <DocPage title="Stripe Connect API">
      <p>
        Link a Stripe Connect Express account so your organization can receive escrow payouts.
        Available on Developer and Enterprise. Capabilities sync via the{' '}
        <code>account.updated</code> Stripe webhook.
      </p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
