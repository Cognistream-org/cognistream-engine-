import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, cleanupOrg, createTestOrgWithKey } from '../test/helpers.js';

describe('api-keys API integration', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let adminKey: string;
  let noAdminKey: string;
  let noAdminOrgId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const admin = await createTestOrgWithKey({
      scopes: ['read:agents', 'admin:keys'],
    });
    orgId = admin.org.id;
    adminKey = admin.plaintextKey;

    const limited = await createTestOrgWithKey({
      scopes: ['read:agents'],
    });
    noAdminOrgId = limited.org.id;
    noAdminKey = limited.plaintextKey;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(orgId);
    await cleanupOrg(noAdminOrgId);
    await app.close();
  });

  it('returns 401 for unauthorized access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when admin:keys scope is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { 'x-api-key': noAdminKey },
      payload: {
        name: 'blocked',
        scopes: ['read:agents'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('creates an API key and returns plaintext once', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { 'x-api-key': adminKey },
      payload: {
        name: 'ci-key',
        scopes: ['read:agents', 'write:agents'],
        expiresInDays: 30,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.key).toMatch(/^cs_live_/);
    expect(created.name).toBe('ci-key');
    expect(created.scopes).toEqual(['read:agents', 'write:agents']);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { 'x-api-key': adminKey },
    });

    expect(listResponse.statusCode).toBe(200);
    const list = listResponse.json();
    const listed = list.data.find((item: { id: string }) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed.key).toBeUndefined();
    expect(listed.name).toBe('ci-key');
    expect(list.meta.page).toBe(1);
    expect(list.meta.limit).toBe(20);
    expect(list.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('paginates API keys', async () => {
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: { 'x-api-key': adminKey },
        payload: {
          name: `page-key-${i}`,
          scopes: ['read:agents'],
        },
      });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/v1/api-keys?page=1&limit=2',
      headers: { 'x-api-key': adminKey },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data).toHaveLength(2);
    expect(body1.meta.page).toBe(1);
    expect(body1.meta.limit).toBe(2);
    expect(body1.meta.totalPages).toBeGreaterThanOrEqual(2);

    const page2 = await app.inject({
      method: 'GET',
      url: '/v1/api-keys?page=2&limit=2',
      headers: { 'x-api-key': adminKey },
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().data.length).toBeGreaterThan(0);
    expect(page2.json().meta.page).toBe(2);
  });

  it('revokes a key and rejects it immediately', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { 'x-api-key': adminKey },
      payload: {
        name: 'to-revoke',
        scopes: ['read:agents', 'admin:keys'],
      },
    });
    const { id, key } = created.json() as { id: string; key: string };

    // Warm auth cache
    await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { 'x-api-key': key },
    });

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${id}`,
      headers: { 'x-api-key': adminKey },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revokedAt).toBeTruthy();

    const after = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { 'x-api-key': key },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('UNAUTHORIZED');
  });
});
