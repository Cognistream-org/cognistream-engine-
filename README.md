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

This starts:

| Service    | Image            | Port |
|------------|------------------|------|
| PostgreSQL | `postgres:16-alpine` | `5432` |
| Redis      | `redis:7-alpine`     | `6379` |

Check status:

```bash
docker compose ps
```

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
pnpm db:seed
```

Seeds three organizations: `acme-free`, `devtools-labs`, `enterprise-corp`.

### 5. Start apps

```bash
# API on :3001 and web on :3000
pnpm dev
```

Or separately:

```bash
pnpm dev:api
pnpm dev:web
```

### 6. Health check

```bash
curl http://localhost:3001/health
```

Example response:

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": {
    "database": "up",
    "redis": "up"
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm docker:up` | Start Postgres + Redis |
| `pnpm docker:down` | Stop containers |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed organizations |
| `pnpm test` | Run Vitest across packages |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |
| `pnpm typecheck` | TypeScript check |

## Money & data rules

- Monetary values are stored as **integer cents** (`bigint`) — never float/decimal
- Balance-touching DB work must use Prisma `$transaction`
- Primary keys are **UUID v7** (generated in application code)
- No raw SQL in business logic (health checks may use `SELECT 1`)

## License

Apache-2.0
