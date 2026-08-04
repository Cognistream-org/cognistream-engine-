# CogniStream Load Tests (k6)

Scripts under `infra/load-tests/` exercise the API at `http://localhost:3001` by default.

## Prerequisites

1. Install [k6](https://k6.io/docs/get-started/installation/).
2. Run API locally (`pnpm --filter @cognistream/api dev`) with Postgres + Redis.
3. Provision a test org API key and (for write tests) buyer/seller agent ids.

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `BASE_URL` | all | Default `http://localhost:3001` |
| `API_KEY` | smoke (optional), load, stress | `X-API-Key` value |
| `AGENT_ID` | load | Buyer agent id (`X-Agent-Id`) |
| `SELLER_ID` | load | Seller agent id |
| `STRIPE_WEBHOOK_SECRET` | webhook-load | Must match API `STRIPE_WEBHOOK_SECRET` |

## Scripts

| File | Profile | Intent |
|------|---------|--------|
| `api-smoke.js` | 10 VU / 30s | Health + optional `GET /v1/agents` |
| `api-load.js` | 100 VU / 5m | `POST /v1/transactions` create flow |
| `api-stress.js` | ramp to 1000 VU / ~2m | Breaking-point reconnaissance |
| `webhook-load.js` | 50 VU / 3m | `POST /v1/webhooks/stripe` with signed bodies |

### Latency / error budgets

- **Read** paths: p95 `< 200ms`, error rate `< 1%` (`api-smoke.js`)
- **Write** paths: p95 `< 500ms`, error rate `< 1%` (`api-load.js`, `webhook-load.js`)
- **Stress**: looser thresholds (`p95 < 1s`, error rate `< 5%`) — use to find cliffs, not as a ship gate

## Run

```bash
# Smoke
k6 run infra/load-tests/api-smoke.js

# Smoke with auth
API_KEY=csk_test_... k6 run infra/load-tests/api-smoke.js

# Transaction load
API_KEY=... AGENT_ID=... SELLER_ID=... k6 run infra/load-tests/api-load.js

# Stress
API_KEY=... k6 run infra/load-tests/api-stress.js

# Webhooks
STRIPE_WEBHOOK_SECRET=whsec_... k6 run infra/load-tests/webhook-load.js
```

Windows PowerShell:

```powershell
$env:API_KEY="csk_test_..."
k6 run infra/load-tests/api-smoke.js
```

## Observability during tests

- Scrape `GET /metrics` (allowlisted IP) for `cognistream_transactions_total`, `cognistream_rate_limit_hits_total`, `cognistream_db_query_duration_seconds`, etc.
- Watch `/health/ready` and API logs (Pino) — no secrets in log output.

## Safety

- Never point these scripts at production without an approved load-test window.
- Prefer dedicated test orgs with capped balances.
- `api-load.js` creates real escrow rows — clean up or use disposable orgs.
