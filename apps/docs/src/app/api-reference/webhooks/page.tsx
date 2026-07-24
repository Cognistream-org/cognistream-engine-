import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Webhooks API' };

const endpoints = [
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
        Health, overview, WebSocket streaming, and incoming webhook delivery. API keys and webhook
        endpoints are managed in the dashboard.
      </p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
