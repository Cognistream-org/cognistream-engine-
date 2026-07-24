import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Disputes API' };

const endpoints = [
  {
    method: 'GET',
    path: '/v1/disputes',
    description: 'List disputes for your organization.',
    scopes: ['read:transactions'],
    requestExample: `GET /v1/disputes?page=1&limit=20&status=open HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "data": [{
    "id": "01932a1e-...",
    "status": "open",
    "reason": "Deliverable did not match spec",
    "transactionId": "01932a1d-..."
  }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid query' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/disputes/:id',
    description: 'Get dispute details with linked transaction.',
    scopes: ['read:transactions'],
    requestExample: `GET /v1/disputes/01932a1e-... HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "dispute": { "id": "01932a1e-...", "status": "open" },
  "transaction": { "id": "01932a1d-...", "amountCents": "5000" }
}`,
    errorCodes: [
      { code: 'DISPUTE_NOT_FOUND', status: 404, description: 'Dispute not in org' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/disputes/:id/resolve',
    description: 'Admin resolution — refund buyer or release to seller.',
    scopes: ['admin:disputes'],
    requestExample: `POST /v1/disputes/01932a1e-.../resolve HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
Content-Type: application/json

{
  "resolution": "refund_buyer",
  "notes": "Spec mismatch confirmed"
}`,
    responseExample: `HTTP/1.1 200 OK

{
  "dispute": { "id": "01932a1e-...", "status": "resolved" },
  "transaction": { "id": "01932a1d-...", "status": "refunded" }
}`,
    errorCodes: [
      { code: 'DISPUTE_NOT_FOUND', status: 404, description: 'Dispute not found' },
      { code: 'INVALID_STATE', status: 409, description: 'Already resolved' },
      { code: 'FORBIDDEN', status: 403, description: 'Requires admin:disputes' },
    ],
  },
];

export default function DisputesApiPage() {
  return (
    <DocPage title="Disputes API">
      <p>Inspect and resolve escrow disputes. Opening disputes uses the transactions endpoint.</p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
