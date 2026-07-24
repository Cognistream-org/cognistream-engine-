import { ApiEndpointSection, DocPage } from '@/components/api-doc';

export const metadata = { title: 'Agents API' };

const endpoints = [
  {
    method: 'POST',
    path: '/v1/agents',
    description: 'Register a new agent under your organization.',
    scopes: ['write:agents'],
    requestExample: `POST /v1/agents HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...
Content-Type: application/json

{
  "name": "Research Agent",
  "slug": "research-agent",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "metadata": { "model": "gpt-4" }
}`,
    responseExample: `HTTP/1.1 201 Created

{
  "id": "01932a1b-7c3e-7000-8000-000000000001",
  "orgId": "01932a1a-7c3e-7000-8000-000000000001",
  "name": "Research Agent",
  "slug": "research-agent",
  "status": "active",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "reputationScore": 0,
  "createdAt": "2026-07-25T00:00:00.000Z"
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid request body' },
      { code: 'AGENT_CONFLICT', status: 409, description: 'Slug already exists in org' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
      { code: 'FORBIDDEN', status: 403, description: 'Insufficient scopes' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/agents',
    description: 'List agents with pagination and optional status filter.',
    scopes: ['read:agents'],
    requestExample: `GET /v1/agents?page=1&limit=20&status=active HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "data": [{ "id": "01932a1b-...", "name": "Research Agent", "status": "active" }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}`,
    errorCodes: [
      { code: 'VALIDATION_ERROR', status: 422, description: 'Invalid query parameters' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'GET',
    path: '/v1/agents/:id',
    description: 'Get agent details including reputation summary.',
    scopes: ['read:agents'],
    requestExample: `GET /v1/agents/01932a1b-... HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{
  "id": "01932a1b-...",
  "name": "Research Agent",
  "status": "active",
  "reputation": {
    "score": 4.8,
    "totalEvents": 12,
    "recentEvents": []
  }
}`,
    errorCodes: [
      { code: 'AGENT_NOT_FOUND', status: 404, description: 'Agent not in organization' },
      { code: 'UNAUTHORIZED', status: 401, description: 'Missing or invalid API key' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/agents/:id/activate',
    description: 'Set agent status to active.',
    scopes: ['write:agents'],
    requestExample: `POST /v1/agents/01932a1b-.../activate HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{ "id": "01932a1b-...", "status": "active" }`,
    errorCodes: [
      { code: 'AGENT_NOT_FOUND', status: 404, description: 'Agent not found' },
      { code: 'FORBIDDEN', status: 403, description: 'Insufficient scopes' },
    ],
  },
  {
    method: 'POST',
    path: '/v1/agents/:id/deactivate',
    description: 'Set agent status to inactive.',
    scopes: ['write:agents'],
    requestExample: `POST /v1/agents/01932a1b-.../deactivate HTTP/1.1
Host: api.cognistream.io
X-API-Key: cs_live_...`,
    responseExample: `HTTP/1.1 200 OK

{ "id": "01932a1b-...", "status": "inactive" }`,
    errorCodes: [
      { code: 'AGENT_NOT_FOUND', status: 404, description: 'Agent not found' },
      { code: 'FORBIDDEN', status: 403, description: 'Insufficient scopes' },
    ],
  },
];

export default function AgentsApiPage() {
  return (
    <DocPage title="Agents API">
      <p>Manage AI agent identities that send and receive payments on your behalf.</p>
      {endpoints.map((endpoint) => (
        <ApiEndpointSection key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
      ))}
    </DocPage>
  );
}
