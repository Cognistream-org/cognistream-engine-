# Changelog

## [0.2.0] — 2026-07-30

### Added
- **Foundation (PR #7):** encryption at rest helpers, audit trail, resilience (circuit breakers / retries), API maturity hardening
- **Billing schema (PR #8):** Prisma models `StripeConnectAccount`, `Subscription`, `Invoice`, `UsageRecord`, `PlatformFeeLedger`; pricing tiers (`free` / `developer` / `enterprise`) with integer-cent prices and basis-point platform fees
- **Stripe Connect (PR #9):** Express account creation, Account Link onboarding, capability sync, payout eligibility, Connect transfers with circuit breaker + audit
- **Billing service (PR #10):** Stripe Checkout subscriptions, Customer Portal, Redis usage metering, soft (80%) / hard (Free 100%, paid 120%) limit enforcement
- **Platform fees & webhooks (PR #11):** deterministic HALF_UP fee calculation, immutable fee ledger, `POST /v1/webhooks/stripe` with signature verification and Redis idempotency
- **Billing API + SDK + dashboard (PR #12):** `/v1/billing/*` and `/v1/stripe/connect/*` routes; TypeScript SDK `client.billing` / `client.connect`; Next.js billing pages (overview, invoices, usage, upgrade, connect)

### Security
- Stripe webhook authenticity via `Stripe-Signature` (no API key on webhook path)
- Billing mutations accept `X-Idempotency-Key`
- Scopes `read:billing` / `write:billing` gate all billing and Connect endpoints

## [0.1.0] — 2026-07-24

### Added
- Monorepo foundation: `apps/api`, `apps/web`, `packages/shared`
- Docker Compose for PostgreSQL 16 + Redis 7
- Prisma models: Organization, Agent, ApiKey, Transaction, ReputationEvent
- API key auth (`X-API-Key`) with Redis cache + bcrypt hashes
- Multi-window rate limiting (org / agent / endpoint) with fail-closed behavior
- Agents API: create, list, get, activate, deactivate
- API keys API: create (plaintext once), list (paginated), revoke
- Standardized error envelope `{ error: { code, message, requestId } }`
- Vitest coverage gate (≥80%) and Fortune-500 verification checklist

### Security
- Revoked API keys invalidate Redis auth cache via `apikey:id:{id}` mapping
- Auth cache TTL reduced to 5 seconds
- Validation failures return HTTP 422
