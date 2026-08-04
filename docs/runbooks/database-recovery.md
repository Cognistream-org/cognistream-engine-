# Database Recovery Runbook

**Engine:** PostgreSQL 16 + Prisma  
**Last updated:** 2026-08-04

## Backup verification (weekly)

1. Confirm automated backups / volume snapshots exist for the Postgres data volume (`postgres_data` in prod compose).
2. Restore the latest backup into an **isolated** staging instance (never overwrite prod).
3. Run:

```bash
pnpm --filter @cognistream/api exec prisma migrate status
# Smoke: connect and SELECT 1; spot-check organizations / transactions counts
```

4. Record restore duration and any schema drift in the ops log.

### Logical dump (ad-hoc)

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U cognistream -d cognistream -Fc > backup-$(date -u +%Y%m%dT%H%M%SZ).dump
```

### Restore dump (staging)

```bash
pg_restore -U cognistream -d cognistream --clean --if-exists < backup-....dump
```

## Point-in-time recovery (PITR)

Prod compose ships volume-backed Postgres without built-in WAL archiving. For Fortune-500 readiness:

1. Prefer managed Postgres (RDS / Cloud SQL / Azure) with PITR enabled, **or**
2. Configure `archive_command` + continuous base backups outside compose.

**Procedure (managed):**

1. Choose recovery timestamp **before** the damaging write (UTC).
2. Spin a new instance from PITR; do not overwrite the live primary until validated.
3. Validate balances (agents `balanceCents`, escrows, fee ledger) and audit chain sample.
4. Cut over DNS / compose `DATABASE_URL` during a freeze window.
5. Invalidate Redis caches that mirror auth (`apikey:auth:*`) after cutover.

## Migration rollback

Prisma migrations in this repo are **forward-only** by policy.

| Situation | Action |
|-----------|--------|
| Migration not yet applied in prod | Abort deploy; fix migration on a branch |
| Migration applied; app incompatible | Roll **application** back only if schema remains compatible |
| Migration applied; data destructive | Restore from backup / PITR to pre-migration timestamp; re-deploy matching app SHA |
| Need schema undo | Write a **new** forward migration that safely reverses (expand/contract) |

Never `prisma migrate reset` in production.

```bash
# Check state
pnpm --filter @cognistream/api exec prisma migrate status
pnpm --filter @cognistream/api exec prisma migrate deploy
```

## Money-path integrity checks (post-restore)

- Agent balances are **integer cents** (`BigInt`); no floats.
- Escrow rows and transaction statuses consistent (`escrowed` ↔ active escrow amount).
- Audit table: no update/delete paths; optional `validateChain()` sample.
- Stripe objects (subscriptions, Connect accounts) still match DB foreign keys.

## Escalation

P0 data loss or balance inconsistency → [incident-response.md](./incident-response.md) + [escalation.md](./escalation.md).
