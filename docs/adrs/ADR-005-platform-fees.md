# ADR-005: Deterministic BigInt Platform Fee Calculation

Date: 2026-08-04  
Status: Accepted

## Context

Floating-point money math causes rounding drift, irreproducible ledgers, and dispute pain. CogniStream holds escrow and platform fees in **integer cents**. Fee logic must be deterministic across nodes, retries, and idempotent replays.

## Decision

1. **All monetary values are `BigInt` cents** in application and storage — never `number`/`float` for money.
2. **Escrow create fee** (`calculateFeeCents` in transactions): flat **0.5%** using integer division  
   `(amountCents * 5n) / 1000n` (floor).
3. **Tier platform fee** (`platform-fee.ts`): basis points from the org’s pricing tier with **HALF_UP**  
   `(amount * bps + 5000n) / 10000n`, capped at `Number.MAX_SAFE_INTEGER` cents for safety bounds.
4. Fee ledger / Connect transfers consume these deterministic outputs so retries with the same inputs yield the same fee.

## Consequences

- Reproducible fees for audits, idempotency, and dispute evidence
- Floor vs HALF_UP semantics differ by path — document which path applies to each product surface
- Very small amounts may round to `0n` fee on floor paths; product must accept or set minimums
- Engineers must not cast through `number` for intermediate fee math

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| IEEE floats / `decimal.js` in hot path | Floats forbidden by architecture rules; Decimal adds surface area when BigInt suffices |
| Always banker’s rounding | Less familiar; HALF_UP matches common commercial fee expectations for bps |
| Compute fees only in Stripe | Loses escrow-local determinism and offline auditability |
| Store fees as floats in DB | Breaks integer-cent invariant and reporting |
