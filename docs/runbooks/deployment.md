# Production Deployment Runbook

**Service:** CogniStream API + Web  
**Compose file:** `docker-compose.prod.yml`  
**Last updated:** 2026-08-04

## Pre-flight checklist

- [ ] Change window approved; on-call notified
- [ ] Secrets rotated / present in deployment secrets store (never commit `.env`)
- [ ] DB backup completed and restore-tested within last 24h (see [database-recovery.md](./database-recovery.md))
- [ ] Target image tags / commit SHA recorded
- [ ] Stripe webhook endpoint URL matches production ingress
- [ ] Rollback plan reviewed (previous image SHA + migration status)

### Required environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` / `POSTGRES_*` | PostgreSQL 16 |
| `REDIS_URL` | Redis 7 (AOF enabled in prod compose) |
| `ENCRYPTION_KEYS` | AES-256-GCM keyring (`keyId:base64,...`; last key encrypts) |
| `AUDIT_HMAC_KEY` | Audit chain HMAC (≥32 bytes, base64) |
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_PUBLISHABLE_KEY` | Client / Connect flows |
| `CORS_ORIGINS` | Explicit browser origin whitelist |
| `METRICS_IP_ALLOWLIST` | Who may scrape `GET /metrics` |
| `NEXT_PUBLIC_API_URL` | Web → API public URL |
| `OTEL_*` (optional) | Trace export |

## Deploy steps

1. **Freeze** non-urgent deploys; announce in ops channel.
2. **Backup** Postgres (logical dump or snapshot) and note Redis AOF volume health.
3. **Pull / build** from the release commit:

```bash
git fetch origin
git checkout <release-sha>
docker compose -f docker-compose.prod.yml build api web
```

4. **Migrate** before switching traffic (API container or one-off job):

```bash
pnpm --filter @cognistream/api exec prisma migrate deploy
```

5. **Roll** services (postgres/redis first if infra change; then api; then web/nginx):

```bash
docker compose -f docker-compose.prod.yml up -d
```

6. **Verify health**
   - `GET /health` — liveness
   - `GET /health/ready` — DB + Redis
   - `GET /health/deep` — deep check (DB + Redis + disk)
   - Nginx `GET /healthz`
   - `GET /metrics` from an allowlisted IP (Prometheus text format)

7. **Smoke** (authenticated)
   - `GET /v1/agents` with a test org API key → 200
   - Create a small escrow transaction in a non-prod-data org if available
   - Confirm Stripe Dashboard shows recent webhook deliveries as `200`

8. **Observe** 15–30 minutes: error rate, p95 latency, circuit breaker gauges, rate-limit counters.

## Post-deploy

- [ ] Tag release in git / changelog
- [ ] Confirm audit worker is processing (`cognistream:audit:queue` not growing unboundedly)
- [ ] Confirm no spike in `cognistream_rate_limit_hits_total` or 5xx

## Rollback (summary)

1. Redeploy previous image SHA for `api` / `web`.
2. If a migration is unsafe to leave applied, follow [database-recovery.md](./database-recovery.md) — prefer forward-fix migrations over down-migrations.
3. Re-point Stripe webhook only if URL changed.
4. See [incident-response.md](./incident-response.md) for severity and escalation.
