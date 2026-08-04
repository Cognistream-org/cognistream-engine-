import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Webhooks API' };

const endpoints = [
  {
    method: 'POST',
    path: '/v1/webhooks/stripe',
    description:
      'Stripe event receiver. No API key — authenticity is verified via Stripe-Signature. Idempotent via Redis.',
    scopes: ['(none — Stripe-Signature)'],
    requestExample: `POST /v1/webhooks/stripe HTTP/1.1
Host: api.cognistream.io
Stripe-Signature: t=...,v1=...
Content-Type: application/json

{
  "id": "evt_...",
  "object": "event",
  "type": "customer.subscription.updated",
  "data": { "object": { "id": "sub_...", "status": "active" } },
  "livemode": false
}`,
    responseExample: `HTTP/1.1 200 OK

{ "received": true }`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 401, description: 'Stripe-Signature verification failed' },
      { code: 'VALIDATION_ERROR', status: 400, description: 'Invalid payload' },
      { code: 'RATE_LIMITED', status: 429, description: 'Too many requests' },
    ],
  },
  {
    method: 'GET',
    path: '/health',
    description: 'Public health check — no authentication required.',
    scopes: ['(none)'],
    requestExample: `GET /health HTTP/1.1
Host: api.cognistream.io`,
    responseExample: `HTTP/1.1 200 OK

{
  "status": "ok",
  "timestamp": "2026-07-25T00:00:00.000Z",
  "services": { "database": "up", "redis": "up" }
}`,
    errorCodes: [
      { code: 'SERVICE_DEGRADED', status: 503, description: 'Database or Redis unavailable' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/overview',
    description: 'Dashboard stats for the authenticated organization.',
    scopes: ['read:transactions'],
    requestExample: `GET /v1/overview HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "organization": { "name": "Acme AI", "balanceCents": "100000" },
  "stats": {
    "transactionsThisMonth": 42,
    "volumeCentsThisMonth": "250000",
    "activeAgents": 8
  }
}`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 401, description: 'Invalid API key' },
    ],
  },
  {
    method: 'WS',
    path: '/v1/stream',
    description:
      'WebSocket stream for real-time org events. Authenticate via ?api_key= query parameter.',
    scopes: ['(valid API key)'],
    requestExample: `GET /v1/stream?api_key=cs_live_... HTTP/1.1
Upgrade: websocket
Connection: Upgrade`,
    responseExample: `{
  "event": "connected",
  "orgId": "01932a1a-...",
  "occurredAt": "2026-07-25T00:00:00.000Z"
}

{
  "event": "transaction.updated",
  "data": { "transactionId": "01932a1d-...", "status": "held" }
}`,
    errorCodes: [
      { code: 'UNAUTHORIZED', status: 1008, description: 'WebSocket close — invalid API key' },
    ],
  },
  {
    method: 'POST',
    path: '(incoming webhook)',
    description:
      'CogniStream POSTs signed events to your configured HTTPS endpoints. Managed via dashboard, not REST.',
    scopes: ['(webhook secret)'],
    requestExample: `POST https://your-app.com/webhooks/cognistream HTTP/1.1
X-CogniStream-Signature: sha256=...
Content-Type: application/json

{
  "id": "evt_...",
  "type": "transaction.created",
  "data": { "transactionId": "..." }
}`,
    responseExample: `HTTP/1.1 200 OK

(your endpoint should return 2xx within 10s)`,
    errorCodes: [
      { code: 'SIGNATURE_INVALID', status: 401, description: 'Reject on your side if HMAC fails' },
      { code: 'DELIVERY_FAILED', status: 502, description: 'CogniStream retries after non-2xx' },
    ],
  },
];

export default function WebhooksApiPage() {
  return (
    <DocPage title="Webhooks & Real-time API">
      <p>
        Stripe inbound webhooks (<code>/v1/webhooks/stripe</code>), health, overview, WebSocket
        streaming, and outbound webhook delivery to your endpoints. Stripe events handled include{' '}
        <code>account.updated</code>, <code>customer.subscription.*</code>, <code>invoice.*</code>,
        and <code>transfer.*</code>.
      </p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
