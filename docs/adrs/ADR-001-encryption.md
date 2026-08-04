# ADR-001: Field Encryption with AES-256-GCM and Key Rotation

Date: 2026-08-04  
Status: Accepted

## Context

CogniStream stores sensitive fields (e.g. webhook secrets, agent metadata) in PostgreSQL. Payment infrastructure must protect secrets at rest without blocking operational key rotation or Prisma-based access patterns. Encryption must be authenticated (tamper-evident) and support multiple active keys so ciphertext written under an old key remains readable.

## Decision

Use **AES-256-GCM** via Node `crypto` with:

- 32-byte keys, 12-byte IV, 16-byte auth tag
- Envelope `{ ciphertext, iv, keyId, tag }` (base64) persisted as JSON text / JSON fields
- Environment keyring `ENCRYPTION_KEYS=keyId:base64,...` where the **last** entry is the primary encryption key and **all** entries may decrypt
- Prisma extension (`prisma-encryption`) transparently encrypts/decrypts configured columns
- Key rotation = append a new keyId at the end; optionally re-encrypt rows offline later

## Consequences

- Authenticated encryption prevents silent ciphertext tampering
- Rotation does not require a big-bang re-encrypt to stay online
- Operators must never drop old keys until all rows using that `keyId` are re-encrypted
- Misconfigured or missing `ENCRYPTION_KEYS` fails fast outside test
- Slight storage overhead and CPU cost on read/write of encrypted columns

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Application-level AES-CBC | No built-in integrity; foot-guns around padding/IV |
| Database TDE only | Does not protect against app-level exfiltration of column values; weaker key hygiene story for field-level secrets |
| KMS envelope per-row without local GCM | Higher latency and vendor lock-in; can be layered later using the same `keyId` indirection |
| Single immutable key | Blocks rotation and incident response after key compromise |
