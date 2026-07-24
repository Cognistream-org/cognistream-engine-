import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const KEY_PREFIX = 'cs_live_';
const RANDOM_BYTES = 36; // 48 base64url chars
const BCRYPT_ROUNDS = 12;

export function generateApiKey(): { key: string; keyPrefix: string } {
  const random = randomBytes(RANDOM_BYTES).toString('base64url').slice(0, 48);
  const key = `${KEY_PREFIX}${random}`;
  return { key, keyPrefix: key.slice(0, 16) };
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/** Stable non-secret cache key for Redis (never store plaintext API keys). */
export function apiKeyCacheId(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
