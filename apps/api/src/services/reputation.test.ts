import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateReputationDelta, getReputation, updateReputation } from './reputation.js';
import { cleanupOrg, createTestAgent, createTestOrgWithKey } from '../test/helpers.js';
import { AppError } from '../lib/errors.js';

describe('calculateReputationDelta', () => {
  it('applies positive_trade rating deltas', () => {
    expect(calculateReputationDelta('positive_trade', 5).toString()).toBe('0.002');
    expect(calculateReputationDelta('positive_trade', 4).toString()).toBe('0.001');
    expect(calculateReputationDelta('positive_trade', 3).toString()).toBe('0.0005');
    expect(calculateReputationDelta('positive_trade', 2).toString()).toBe('-0.001');
    expect(calculateReputationDelta('positive_trade', 1).toString()).toBe('-0.001');
  });

  it('applies negative_trade delta', () => {
    expect(calculateReputationDelta('negative_trade').toString()).toBe('-0.005');
  });

  it('applies dispute_resolved favor and against', () => {
    expect(calculateReputationDelta('dispute_resolved', undefined, true).toString()).toBe('0.001');
    expect(calculateReputationDelta('dispute_resolved', undefined, false).toString()).toBe('-0.01');
    expect(calculateReputationDelta('dispute_resolved', 5).toString()).toBe('0.001');
    expect(calculateReputationDelta('dispute_resolved', 1).toString()).toBe('-0.01');
  });
});

describe('updateReputation / getReputation', () => {
  let orgId: string;
  let agentId: string;

  beforeAll(async () => {
    const org = await createTestOrgWithKey();
    orgId = org.org.id;
    const agent = await createTestAgent(orgId, { balanceCents: 0n });
    agentId = agent.id;
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
  });

  it('updates score atomically and returns summary', async () => {
    const updated = await updateReputation(agentId, 'positive_trade', 5);
    expect(updated.delta).toBe('0.0020');
    expect(Number(updated.currentScore)).toBeGreaterThan(Number(updated.previousScore));

    await updateReputation(agentId, 'negative_trade');
    const summary = await getReputation(agentId);
    expect(summary.currentScore).toBeTruthy();
    expect(summary.history.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects invalid rating for positive_trade', async () => {
    await expect(updateReputation(agentId, 'positive_trade')).rejects.toBeInstanceOf(AppError);
  });

  it('clamps score to [0, 1]', async () => {
    for (let i = 0; i < 30; i += 1) {
      await updateReputation(agentId, 'dispute_resolved', 1, { favorable: false });
    }
    const summary = await getReputation(agentId);
    expect(Number(summary.currentScore)).toBeGreaterThanOrEqual(0);
    expect(Number(summary.currentScore)).toBeLessThanOrEqual(1);
  });
});
