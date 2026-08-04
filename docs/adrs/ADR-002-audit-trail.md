# ADR-002: Immutable HMAC-Chained Audit Trail

Date: 2026-08-04  
Status: Accepted

## Context

Regulated payment and agent activity requires a tamper-evident history of security-relevant actions (transactions, authz-sensitive events). Classic mutable audit tables can be edited by a compromised DB credential. We need append-only semantics, integrity verification, and low latency on the request path.

## Decision

Implement an **HMAC-SHA256 hash chain** over audit records:

- Each row stores `previousHash` and `integrityHash = HMAC(prevHash \| GENESIS + payload + timestamp)`
- Secret: `AUDIT_HMAC_KEY` (base64, ≥32 bytes)
- Writers enqueue via Redis (`cognistream:audit:queue`); a background worker persists rows so HTTP handlers stay non-blocking
- Prisma extension rejects `update` / `delete` on audit models (`AuditImmutableError`)
- `validateChain()` recomputes hashes for integrity checks (skips legacy unhashed rows if any)

## Consequences

- Tampering with historical rows breaks the chain under verification
- Compromised DB user cannot quietly “fix” history without also knowing `AUDIT_HMAC_KEY` (and even then, offline verification against external copies still helps)
- Redis outage can delay audit persistence — monitor queue depth
- Key rotation for HMAC requires a deliberate dual-key or re-seal strategy (document before rotating)

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Plain append-only table, no MAC | Detects nothing if attacker updates hashes/content together |
| Blockchain / external ledger | Operationally heavy for MVP; can export chain digests later |
| Sync DB write on every request | Adds latency and coupling to audit availability |
| WORM object storage only | Harder to query; still valuable as a secondary archive later |
