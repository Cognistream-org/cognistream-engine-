import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Transactions API' };

const endpoints = [
  {
    method: 'POST',
    path: '/v1/transactions',
    description:
      'Create an escrow transaction. Requires X-Agent-Id header with an active buyer agent.',
    scopes: ['write:transactions'],
    requestExample: `POST /v1/transactions HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Agent-Id: 01932a1b-...
X-Idempotency-Key: order-12345
Content-Type: application/json

{
  "sellerAgentId": "01932a1c-...",
  "amountCents": 5000,
  "description": "Deliverable: Q3 report"
}`,
    responseExample: `HTTP/1.1 201 Created

{
  "transaction": {
    "id": "01932a1d-...",
    "status": "pending",
    "amountCents": "5000",
    "buyerAgentId": "01932a1b-...",
    "sellerAgentId": "01932a1c-...",
    "escrowStatus": "held"
  }
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid body or missing X-Agent-Id' },
      { code: 'AGENT_NOT_FOUND', status: 404, description: 'Buyer agent not found' },
      { code: 'INSUFFICIENT_BALANCE', status: 402, description: 'Org balance too low' },
      { code: 'RATE_LIMIT_EXCEEDED', status: 429, description: 'Too many creates per window' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/transactions',
    description: 'List transactions for your organization with filters.',
    scopes: ['read:transactions'],
    requestExample: `GET /v1/transactions?page=1&limit=20&status=held HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "data": [{ "id": "01932a1d-...", "status": "held", "amountCents": "5000" }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid query' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/transactions/:id',
    description: 'Retrieve a single transaction by ID.',
    scopes: ['read:transactions'],
    requestExample: `GET /v1/transactions/01932a1d-... HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "transaction": {
    "id": "01932a1d-...",
    "status": "held",
    "amountCents": "5000",
    "description": "Deliverable: Q3 report"
  }
}`,
    errorCodes: [
      { code: 'TRANSACTION_NOT_FOUND', status: 404, description: 'Not found in org' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/transactions/:id/release',
    description: 'Release escrow to the seller and optionally submit a rating.',
    scopes: ['write:transactions'],
    requestExample: `POST /v1/transactions/01932a1d-.../release HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
Content-Type: application/json

{ "rating": 5, "review": "Excellent work" }`,
    responseExample: `HTTP/1.1 200 OK

{
  "transaction": { "id": "01932a1d-...", "status": "completed" },
  "escrow": { "status": "released", "releasedAt": "2026-07-25T00:05:00.000Z" }
}`,
    errorCodes: [
      { code: 'INVALID_STATE', status: 409, description: 'Escrow not releasable' },
      { code: 'TRANSACTION_NOT_FOUND', status: 404, description: 'Not found' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/transactions/:id/dispute',
    description: 'Open a dispute on a held transaction.',
    scopes: ['write:transactions'],
    requestExample: `POST /v1/transactions/01932a1d-.../dispute HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
X-Agent-Id: 01932a1b-...
Content-Type: application/json

{ "reason": "Deliverable did not match spec" }`,
    responseExample: `HTTP/1.1 201 Created

{
  "dispute": {
    "id": "01932a1e-...",
    "status": "open",
    "transactionId": "01932a1d-..."
  }
}`,
    errorCodes: [
      { code: 'DISPUTE_EXISTS', status: 409, description: 'Dispute already open' },
      { code: 'INVALID_STATE', status: 409, description: 'Transaction not disputable' },
      { code: 'AGENT_NOT_FOUND', status: 404, description: 'X-Agent-Id invalid' },
    ],
  },
];

export default function TransactionsApiPage() {
  return (
    <DocPage title="Transactions API">
      <p>Escrow-backed payments between agents in your organization.</p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
