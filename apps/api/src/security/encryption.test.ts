import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  createEncryptionService,
  EncryptionError,
  isEncryptedPayload,
  parseEncryptionKeys,
  type EncryptedPayload,
} from './encryption.js';

function keyB64(bytes = randomBytes(32)): string {
  return bytes.toString('base64');
}

describe('parseEncryptionKeys', () => {
  it('parses multiple keys and uses the last as primary', () => {
    const k1 = keyB64();
    const k2 = keyB64();
    const ring = parseEncryptionKeys(`old:${k1},new:${k2}`);
    expect(ring.primaryKeyId).toBe('new');
    expect(ring.keys.size).toBe(2);
    expect(ring.keys.get('old')).toEqual(Buffer.from(k1, 'base64'));
  });

  it('rejects empty, malformed, wrong length, and duplicate ids', () => {
    expect(() => parseEncryptionKeys('')).toThrow(EncryptionError);
    expect(() => parseEncryptionKeys('nocolon')).toThrow(EncryptionError);
    expect(() => parseEncryptionKeys('id:')).toThrow(EncryptionError);
    expect(() => parseEncryptionKeys(`bad:${Buffer.from('short').toString('base64')}`)).toThrow(
      EncryptionError,
    );
    const k = keyB64();
    expect(() => parseEncryptionKeys(`a:${k},a:${k}`)).toThrow(/Duplicate/);
  });
});

describe('EncryptionService', () => {
  const keyA = keyB64();
  const keyB = keyB64();
  const service = createEncryptionService(`v1:${keyA}`);

  it('roundtrips plaintext', () => {
    const payload = service.encrypt('secret-value');
    expect(payload.keyId).toBe('v1');
    expect(payload.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(payload.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(payload.tag).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(service.decrypt(payload)).toBe('secret-value');
  });

  it('roundtrips JSON fields', () => {
    const data = { email: 'a@b.co', nested: { n: 1 } };
    const enc = service.encryptJsonField(data);
    expect(isEncryptedPayload(enc)).toBe(true);
    expect(service.decryptJsonField(enc)).toEqual(data);
  });

  it('serializes and deserializes string fields', () => {
    const stored = service.encryptStringField('whsec_abc');
    expect(stored.startsWith('{')).toBe(true);
    expect(service.decryptStringField(stored)).toBe('whsec_abc');
  });

  it('passes through legacy plaintext string and plain JSON', () => {
    expect(service.decryptStringField('legacy-plain')).toBe('legacy-plain');
    expect(service.decryptJsonField({ foo: 1 })).toEqual({ foo: 1 });
    expect(service.decryptJsonField(null)).toBeNull();
  });

  it('supports key rotation (encrypt with new, decrypt with old ring)', () => {
    const rotated = createEncryptionService(`v1:${keyA},v2:${keyB}`);
    const withNew = rotated.encrypt('rotated');
    expect(withNew.keyId).toBe('v2');
    expect(rotated.decrypt(withNew)).toBe('rotated');

    // Old ciphertext still decrypts after rotation
    const withOld = service.encrypt('still-valid');
    expect(rotated.decrypt(withOld)).toBe('still-valid');
  });

  it('fails with wrong key id', () => {
    const payload = service.encrypt('x');
    const other = createEncryptionService(`other:${keyB}`);
    expect(() => other.decrypt(payload)).toThrow(/Unknown encryption key/);
  });

  it('detects tampering of ciphertext, tag, or iv', () => {
    const payload = service.encrypt('tamper-me');

    const badCipher: EncryptedPayload = {
      ...payload,
      ciphertext: Buffer.from('tampered').toString('base64'),
    };
    expect(() => service.decrypt(badCipher)).toThrow(/Decryption failed/);

    const badTag: EncryptedPayload = {
      ...payload,
      tag: randomBytes(16).toString('base64'),
    };
    expect(() => service.decrypt(badTag)).toThrow(/Decryption failed/);

    const badIv: EncryptedPayload = {
      ...payload,
      iv: randomBytes(12).toString('base64'),
    };
    expect(() => service.decrypt(badIv)).toThrow(/Decryption failed/);
  });

  it('rejects invalid envelope shapes', () => {
    expect(() => service.deserialize('not-json')).toThrow(EncryptionError);
    expect(() => service.deserialize(JSON.stringify({ foo: 1 }))).toThrow(EncryptionError);
    expect(() =>
      service.decrypt({
        ciphertext: 'x',
        iv: Buffer.from('short').toString('base64'),
        keyId: 'v1',
        tag: randomBytes(16).toString('base64'),
      }),
    ).toThrow(/Invalid IV/);
  });

  it('never includes plaintext in encrypt result', () => {
    const secret = 'super-secret-pii';
    const payload = service.encrypt(secret);
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain(secret);
  });
});
