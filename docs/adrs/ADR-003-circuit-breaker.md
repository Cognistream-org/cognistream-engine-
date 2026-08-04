# ADR-003: Circuit Breaker for Stripe Dependencies

Date: 2026-08-04  
Status: Accepted

## Context

Stripe Connect, Billing, and webhook processing are remote dependencies. Cascading retries during Stripe or network incidents amplify load, exhaust connection pools, and turn a vendor blip into a full API outage. CogniStream needs fail-fast behavior with controlled recovery.

## Decision

Use a shared **circuit breaker** (`apps/api/src/resilience/circuit-breaker.ts`) around Stripe calls, combined with bounded `withRetry`:

| Breaker name | Typical use | Failure threshold |
|--------------|-------------|-------------------|
| `stripe` | Connect + Billing API calls | 5 |
| `stripe_webhook` | Inbound webhook processing | 10 |
| `external_webhook` | Outbound org webhooks | 50 |

Defaults: `resetTimeoutMs = 30_000`, `halfOpenMaxCalls = 3`. State exposed via resilience gauges for ops. Breakers wrap (or sit beside) retries so open circuits stop hammering Stripe.

## Consequences

- Fast failure when Stripe is unhealthy; protects Postgres/Redis and our latency SLOs
- Callers must handle breaker-open errors (user-visible degradation vs queue-for-later)
- Thresholds differ by path: webhooks tolerate more transient faults than interactive Billing
- Mis-tuned thresholds can flap — alert on open state duration

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Unlimited retries only | Worsens outages (retry storm) |
| Global request timeout only | Does not trip after repeated failures across requests |
| Queue-all Stripe work always | Higher complexity; still need breakers on workers |
| Per-org breakers only | Misses vendor-wide incidents; can add later as a second layer |
