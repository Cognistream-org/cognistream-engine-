import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  cleanupOrg,
  createTestAgent,
  createTestOrgWithKey,
} from '../test/helpers.js';

describe('overview API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const org = await createTestOrgWithKey({ orgBalanceCents: 42_000n });
    orgId = org.org.id;
    apiKey = org.plaintextKey;
    await createTestAgent(orgId, { balanceCents: 1_000n });
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
    await app.close();
  });

  it('returns org balance and monthly stats', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/overview',
      headers: { 'x-api-key': apiKey },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.organization.balanceCents).toBe('42000');
    expect(body.stats.activeAgents).toBeGreaterThanOrEqual(1);
    expect(body.stats.transactionsThisMonth).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toMatch(/agent.*balance/i);
  });
});
