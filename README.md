# CogniStream Engine

High-performance AI-to-AI payment infrastructure and escrow engine.

**Stack:** Fastify · Prisma · PostgreSQL 16 · Redis 7 · Next.js 15 · TypeScript

## Monorepo layout

```
apps/api          Fastify API + Prisma
apps/web          Next.js 15 dashboard + marketing landing
apps/docs         Developer documentation (port 3002)
packages/shared   Shared Zod schemas and TypeScript types
packages/sdk      Official TypeScript SDK (@cognistream/sdk)
```

## Try it locally in 60 seconds

One command spins up API, web, docs, Postgres, and Redis — pre-seeded with **3 orgs**, **10 agents**, **20 transactions**, and **2 disputes**:

```bash
docker compose -f docker-compose.demo.yml up --build
```

| Surface | URL |
|---------|-----|
| Landing + dashboard | http://localhost:3000 |
| API | http://localhost:3001 |
| Docs | http://localhost:3002 |

API keys for each demo org are printed in the `api` container logs on first boot.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Docker + Docker Compose

## Quick start (local development)

### 1. Start infrastructure

```bash
docker compose up -d
```

| Service    | Image                | Port |
|------------|----------------------|------|
| PostgreSQL | `postgres:16-alpine` | `5432` |
| Redis      | `redis:7-alpine`     | `6379` |

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local
```

### 4. Run migrations and seed

```bash
pnpm db:generate
pnpm --filter @cognistream/api exec prisma migrate deploy
pnpm --filter @cognistream/api run db:seed
```

Seeds **2 organizations** (`acme-free`, `devtools-labs`), **3 agents per org**, **1 API key per org**, and **5 transactions**. Seed prints each API key once to the console.

For the fuller demo dataset locally: `pnpm db:seed:demo`.

### 5. Start apps

```bash
pnpm dev
```

- API: `http://localhost:3001`
- Web: `http://localhost:3000`
- Docs: `http://localhost:3002`

### 6. Health check

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": { "database": "up", "redis": "up" }
}
```

## API examples

All `/v1` routes require `X-API-Key`.

### Create agent

```bash
curl -X POST http://localhost:3001/v1/agents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cs_live_..." \
  -d '{"name":"Alpha","publicKey":"pk_alpha","capabilities":["chat"]}'
```

```json
{
  "id": "...",
  "orgId": "...",
  "name": "Alpha",
  "publicKey": "pk_alpha",
  "capabilities": ["chat"],
  "reputationScore": "0.5000",
  "status": "active"
}
```

### List agents

```bash
curl "http://localhost:3001/v1/agents?capability=chat&page=1&limit=20" \
  -H "X-API-Key: cs_live_..."
```

```json
{
  "data": [{ "id": "...", "name": "Alpha", "status": "active" }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### Create API key (plaintext shown once)

```bash
curl -X POST http://localhost:3001/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cs_live_..." \
  -d '{"name":"ci","scopes":["read:agents","admin:keys"]}'
```

```json
{
  "id": "...",
  "name": "ci",
  "key": "cs_live_...",
  "scopes": ["read:agents", "admin:keys"]
}
```

### List API keys (metadata only)

```bash
curl "http://localhost:3001/v1/api-keys?page=1&limit=20" \
  -H "X-API-Key: cs_live_..."
```

```json
{
  "data": [{ "id": "...", "name": "ci", "scopes": ["read:agents"], "revokedAt": null }],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### Create subscription checkout

Requires `write:billing`. Upgrades to Developer or Enterprise via Stripe Checkout.

```bash
curl -X POST http://localhost:3001/v1/billing/checkout \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cs_live_..." \
  -H "X-Idempotency-Key: checkout-001" \
  -d '{
    "tier":"developer",
    "cycle":"monthly",
    "successUrl":"https://app.example.com/billing/success",
    "cancelUrl":"https://app.example.com/billing/cancel"
  }'
```

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}
```

### Get usage

Requires `read:billing`. Returns meters for the current billing period (`YYYY-MM`).

```bash
curl http://localhost:3001/v1/billing/usage \
  -H "X-API-Key: cs_live_..."
```

```json
{
  "orgId": "...",
  "billingPeriod": "2026-07",
  "tier": "developer",
  "meters": {
    "api_calls": { "usage": 120, "limit": 10000, "hardLimit": 12000 },
    "transactions": { "usage": 15, "limit": 1000, "hardLimit": 1200 },
    "transaction_volume_cents": { "usage": 50000, "limit": 50000000, "hardLimit": 60000000 }
  }
}
```

### Connect Stripe account

Requires `write:billing` (Developer/Enterprise). Creates a Stripe Connect Express account for payouts.

```bash
curl -X POST http://localhost:3001/v1/stripe/connect \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cs_live_..." \
  -H "X-Idempotency-Key: connect-001" \
  -d '{"country":"us"}'
```

```json
{
  "id": "...",
  "orgId": "...",
  "stripeAccountId": "acct_...",
  "status": "pending",
  "chargesEnabled": false,
  "payoutsEnabled": false,
  "country": "us",
  "defaultCurrency": "usd"
}
```

Error envelope:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Missing or invalid API key", "requestId": "..." } }
```

## Billing & Pricing

Organizations start on **Free** and can upgrade via Stripe Checkout.

| Tier | Monthly | Yearly | Platform fee | Soft limit | Hard limit |
|------|---------|--------|--------------|------------|------------|
| Free | $0 | $0 | 3.50% (350 bp) | 80% of quota | 100% of quota |
| Developer | $49 | $490 | 2.50% (250 bp) | 80% of quota | 120% of quota |
| Enterprise | $299 | $2,990 | 1.50% (150 bp) | 80% of quota | 120% of quota |

**Usage limits (selected):**

| Meter | Free | Developer | Enterprise |
|-------|------|-----------|------------|
| API calls / mo | 1,000 | 10,000 | 100,000 |
| Transactions / mo | 100 | 1,000 | 10,000 |
| Volume / mo | $50,000 | $500,000 | $5,000,000 |
| Agents | 3 | 10 | 100 |

Platform fees are calculated in **integer cents** (basis points, HALF_UP) and recorded in an immutable `PlatformFeeLedger`. Soft warnings fire at 80%; Free blocks at 100%, paid tiers allow 20% overage headroom before hard block.

Scopes: `read:billing`, `write:billing`.

## Stripe Connect

Seller organizations on Developer/Enterprise can link a Stripe Connect Express account to receive payouts after escrow release:

1. `POST /v1/stripe/connect` — create account (`country` ISO-2)
2. `POST /v1/stripe/connect/onboarding` — Account Link for KYC (`returnUrl`, `refreshUrl`)
3. Stripe fires `account.updated` → CogniStream syncs `chargesEnabled` / `payoutsEnabled`
4. Platform fee transfers settle to the Connect account when payouts are enabled

`GET /v1/stripe/connect` returns status; `DELETE /v1/stripe/connect` disconnects.

## Webhooks

`POST /v1/webhooks/stripe` is **unauthenticated**. Stripe authenticity is verified with the `Stripe-Signature` header. Deliveries are idempotent (Redis) so retries are safe.

Handled event types:

- `account.updated` — sync Connect account capabilities
- `customer.subscription.created` / `.updated` / `.deleted` — subscription lifecycle
- `invoice.created` / `.paid` / `.payment_failed` — invoice upsert
- `transfer.created` / transfer failure — platform fee ledger transfer status

Configure the endpoint in the Stripe Dashboard to point at your API host `/v1/webhooks/stripe`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm docker:up` | Start Postgres + Redis |
| `pnpm docker:down` | Stop containers |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed organizations / agents / keys |
| `pnpm test` | Vitest (API includes coverage) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |

## Money & data rules

- Monetary values are stored as **integer cents** (`bigint`) — never float/decimal
- Balance-touching DB work must use Prisma `$transaction`
- Primary keys are **UUID v7** (generated in application code)
- No raw SQL in business logic (health checks may use `SELECT 1`)

## License

Apache-2.0
