import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  keyId: string;
  tag: string;
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export type EncryptionKeyring = {
  /** keyId → raw 32-byte key */
  keys: Map<string, Buffer>;
  /** Key used for new encrypts (last entry in ENCRYPTION_KEYS). */
  primaryKeyId: string;
};

/**
 * Parse `ENCRYPTION_KEYS="key1:base64...,key2:base64..."`.
 * The last key is the primary (used for encryption); all keys decrypt.
 */
export function parseEncryptionKeys(raw: string): EncryptionKeyring {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new EncryptionError('ENCRYPTION_KEYS is empty');
  }

  const keys = new Map<string, Buffer>();
  let primaryKeyId = '';

  for (const part of trimmed.split(',')) {
    const segment = part.trim();
    if (!segment) continue;

    const colon = segment.indexOf(':');
    if (colon <= 0 || colon === segment.length - 1) {
      throw new EncryptionError(
        'Invalid ENCRYPTION_KEYS entry; expected keyId:base64',
      );
    }

    const keyId = segment.slice(0, colon).trim();
    const keyB64 = segment.slice(colon + 1).trim();
    if (!keyId || !keyB64) {
      throw new EncryptionError(
        'Invalid ENCRYPTION_KEYS entry; expected keyId:base64',
      );
    }
    if (keys.has(keyId)) {
      throw new EncryptionError(`Duplicate encryption key id: ${keyId}`);
    }

    let key: Buffer;
    try {
      key = Buffer.from(keyB64, 'base64');
    } catch {
      throw new EncryptionError(`Invalid base64 for encryption key: ${keyId}`);
    }
    if (key.length !== KEY_LENGTH) {
      throw new EncryptionError(
        `Encryption key ${keyId} must be ${KEY_LENGTH} bytes (got ${key.length})`,
      );
    }

    keys.set(keyId, key);
    primaryKeyId = keyId;
  }

  if (keys.size === 0 || !primaryKeyId) {
    throw new EncryptionError('ENCRYPTION_KEYS contained no valid keys');
  }

  return { keys, primaryKeyId };
}

export function createEncryptionService(rawKeys: string): EncryptionService {
  return new EncryptionService(parseEncryptionKeys(rawKeys));
}

export class EncryptionService {
  private readonly keys: Map<string, Buffer>;
  private readonly primaryKeyId: string;

  constructor(keyring: EncryptionKeyring) {
    this.keys = keyring.keys;
    this.primaryKeyId = keyring.primaryKeyId;
  }

  get primaryKey(): string {
    return this.primaryKeyId;
  }

  encrypt(plaintext: string): EncryptedPayload {
    const key = this.keys.get(this.primaryKeyId);
    if (!key) {
      throw new EncryptionError(`Primary key not found: ${this.primaryKeyId}`);
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      keyId: this.primaryKeyId,
      tag: tag.toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const key = this.keys.get(payload.keyId);
    if (!key) {
      throw new EncryptionError(`Unknown encryption key id: ${payload.keyId}`);
    }

    let iv: Buffer;
    let ciphertext: Buffer;
    let tag: Buffer;
    try {
      iv = Buffer.from(payload.iv, 'base64');
      ciphertext = Buffer.from(payload.ciphertext, 'base64');
      tag = Buffer.from(payload.tag, 'base64');
    } catch {
      throw new EncryptionError('Invalid base64 in encrypted payload');
    }

    if (iv.length !== IV_LENGTH) {
      throw new EncryptionError('Invalid IV length');
    }
    if (tag.length !== AUTH_TAG_LENGTH) {
      throw new EncryptionError('Invalid auth tag length');
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new EncryptionError('Decryption failed (tampered or wrong key)');
    }
  }

  encryptJson(value: unknown): EncryptedPayload {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(payload: EncryptedPayload): unknown {
    return JSON.parse(this.decrypt(payload)) as unknown;
  }

  /** Serialize envelope for string columns (e.g. webhook.secret). */
  serialize(payload: EncryptedPayload): string {
    return JSON.stringify(payload);
  }

  deserialize(serialized: string): EncryptedPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      throw new EncryptionError('Encrypted field is not valid JSON');
    }
    if (!isEncryptedPayload(parsed)) {
      throw new EncryptionError('Encrypted field missing required envelope fields');
    }
    return parsed;
  }

  /** Encrypt a string field value for DB storage. */
  encryptStringField(plaintext: string): string {
    return this.serialize(this.encrypt(plaintext));
  }

  /** Decrypt a string field; pass-through legacy plaintext that is not an envelope. */
  decryptStringField(stored: string): string {
    if (!looksLikeEncryptedEnvelope(stored)) {
      return stored;
    }
    return this.decrypt(this.deserialize(stored));
  }

  /** Encrypt a JSON field value for DB storage. */
  encryptJsonField(value: unknown): EncryptedPayload {
    return this.encryptJson(value ?? {});
  }

  /** Decrypt a JSON field; pass-through legacy plain JSON. */
  decryptJsonField(stored: unknown): unknown {
    if (stored === null || stored === undefined) {
      return stored;
    }
    if (isEncryptedPayload(stored)) {
      return this.decryptJson(stored);
    }
    return stored;
  }
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ciphertext === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.keyId === 'string' &&
    typeof obj.tag === 'string'
  );
}

function looksLikeEncryptedEnvelope(stored: string): boolean {
  if (!stored.startsWith('{')) return false;
  try {
    return isEncryptedPayload(JSON.parse(stored) as unknown);
  } catch {
    return false;
  }
}
