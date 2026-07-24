# CogniStream Engine

High-performance AI-to-AI payment infrastructure and escrow engine.

**Stack:** Fastify · Prisma · PostgreSQL 16 · Redis 7 · Next.js 15 · TypeScript

## Monorepo layout

```
apps/api          Fastify API + Prisma
apps/web          Next.js 15 + Tailwind + shadcn/ui
packages/shared   Shared Zod schemas and TypeScript types
```

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Docker + Docker Compose

## Quick start

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

### 5. Start apps

```bash
pnpm dev
```

- API: `http://localhost:3001`
- Web: `http://localhost:3000`

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

Error envelope:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Missing or invalid API key", "requestId": "..." } }
```

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
