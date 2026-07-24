import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, cleanupOrg, createTestOrgWithKey } from '../test/helpers.js';
import { createId } from '../lib/uuid.js';

describe('agents API integration', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;
  let readOnlyKey: string;
  let readOnlyOrgId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const full = await createTestOrgWithKey();
    orgId = full.org.id;
    apiKey = full.plaintextKey;

    const readOnly = await createTestOrgWithKey({
      scopes: ['read:agents'],
    });
    readOnlyOrgId = readOnly.org.id;
    readOnlyKey = readOnly.plaintextKey;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(orgId);
    await cleanupOrg(readOnlyOrgId);
    await app.close();
  });

  it('returns 401 without API key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: {
        name: 'no-auth',
        publicKey: `pk_${createId()}`,
        capabilities: [],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when scope is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': readOnlyKey },
      payload: {
        name: 'forbidden',
        publicKey: `pk_${createId()}`,
        capabilities: ['chat'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    expect(response.json().error.message).toMatch(/write:agents/);
  });

  it('returns 422 for invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: { name: '' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.requestId).toBeTruthy();
  });

  it('creates an agent', async () => {
    const publicKey = `pk_create_${createId()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: {
        name: 'Alpha Agent',
        publicKey,
        capabilities: ['chat', 'search'],
        pricingModel: 'per_request',
        unitPriceCents: 250,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Alpha Agent');
    expect(body.publicKey).toBe(publicKey);
    expect(body.capabilities).toEqual(['chat', 'search']);
    expect(body.unitPriceCents).toBe('250');
    expect(body.orgId).toBe(orgId);
  });

  it('lists agents with filters', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: {
        name: 'Search Agent',
        publicKey: `pk_list_${createId()}`,
        capabilities: ['search'],
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agents?capability=search&status=active&page=1&limit=10',
      headers: { 'x-api-key': apiKey },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(
      body.data.every((agent: { capabilities: string[] }) => agent.capabilities.includes('search')),
    ).toBe(true);
    expect(body.meta.page).toBe(1);
  });

  it('gets agent details and toggles status', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: {
        name: 'Toggle Agent',
        publicKey: `pk_toggle_${createId()}`,
        capabilities: ['chat'],
      },
    });
    const agentId = created.json().id as string;

    const details = await app.inject({
      method: 'GET',
      url: `/v1/agents/${agentId}`,
      headers: { 'x-api-key': apiKey },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json().reputation.score).toBeTruthy();

    const deactivated = await app.inject({
      method: 'POST',
      url: `/v1/agents/${agentId}/deactivate`,
      headers: { 'x-api-key': apiKey },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().status).toBe('inactive');

    const activated = await app.inject({
      method: 'POST',
      url: `/v1/agents/${agentId}/activate`,
      headers: { 'x-api-key': apiKey },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toBe('active');
  });

  it('returns 404 for unknown agent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/agents/01999999-9999-7999-8999-999999999999',
      headers: { 'x-api-key': apiKey },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('AGENT_NOT_FOUND');
  });

  it('returns 409 on duplicate publicKey', async () => {
    const publicKey = `pk_dup_${createId()}`;
    await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: { name: 'first', publicKey, capabilities: [] },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': apiKey },
      payload: { name: 'second', publicKey, capabilities: [] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AGENT_CONFLICT');
  });
});
