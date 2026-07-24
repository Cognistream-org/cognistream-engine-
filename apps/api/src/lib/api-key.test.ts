import { describe, expect, it } from 'vitest';
import { apiKeyCacheId, generateApiKey, hashApiKey, verifyApiKey } from './api-key.js';

describe('api-key helpers', () => {
  it('generates cs_live_ keys with stable prefix length', () => {
    const { key, keyPrefix } = generateApiKey();
    expect(key.startsWith('cs_live_')).toBe(true);
    expect(keyPrefix).toHaveLength(16);
    expect(key.startsWith(keyPrefix)).toBe(true);
  });

  it('hashes and verifies keys', async () => {
    const { key } = generateApiKey();
    const hash = await hashApiKey(key);
    expect(await verifyApiKey(key, hash)).toBe(true);
    expect(await verifyApiKey('cs_live_wrong', hash)).toBe(false);
  });

  it('produces stable cache ids', () => {
    expect(apiKeyCacheId('abc')).toBe(apiKeyCacheId('abc'));
    expect(apiKeyCacheId('abc')).not.toBe(apiKeyCacheId('abd'));
  });
});
