# ADR-004: Free / Developer / Enterprise Pricing Tiers with Usage Limits

Date: 2026-08-04  
Status: Accepted

## Context

CogniStream must monetize API usage while remaining approachable for builders. Unlimited free usage is abuse-prone; a single paid SKU is inflexible for startups vs enterprises. Limits must be enforceable in near real time (Redis-backed counters) with clear upgrade paths.

## Decision

Ship three tiers in `apps/api/src/config/pricing.ts` (amounts in **integer cents**):

| | Free | Developer | Enterprise |
|--|------|-----------|------------|
| Price / mo | $0 | $49 | $299 |
| API calls / mo | 1,000 | 10,000 | 100,000 |
| Transactions / mo | 100 | 1,000 | 10,000 |
| Volume / mo | $50k | $500k | $5M |
| Agents | 3 | 10 | 100 |
| Webhooks | 1 | 5 | 25 |
| Disputes / mo | 5 | 50 | 500 |
| Platform fee | 350 bps | 250 bps | 150 bps |
| Soft / hard limit | Soft 80%; Free hard 100%; paid hard 120% | | |

Feature flags escalate with tier (Connect, analytics, SLA, dedicated support on Enterprise). Overage pricing applies on Free; paid tiers rely on hard ceilings / sales-led expansion.

## Consequences

- Product packaging is code-defined and testable
- Enforcement couples billing counters to request path (usage metering plugin)
- Enterprise needs may still require custom contracts beyond these caps
- Changing limits is a product decision — version carefully for existing subscribers

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Pure pay-as-you-go, no tiers | Harder sales motion; noisy-neighbor risk |
| Soft limits only | No protection against runaway spend / abuse |
| Per-endpoint entitlements matrix | Heavier; tiers cover 80% of needs |
| Unlimited Enterprise by default | Unacceptable risk without contracts / SLA tradeoffs |
