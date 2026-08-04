# Prometheus Metrics

**Last updated:** 2026-08-04

## Endpoint

- **URL:** `GET /metrics`
- **Auth:** IP allowlist via `METRICS_IP_ALLOWLIST` (see `.env.example`)
- **Implementation:** `apps/api/src/telemetry/metrics.ts` + `metrics-route.ts` (`prom-client`)
- **Note:** `apps/api/src/resilience/metrics.ts` holds in-process circuit-breaker gauges for tests/ops snapshots; Prometheus exposition for business SLIs is the telemetry registry above.

## Custom metrics

| Metric | Type | Labels |
|--------|------|--------|
| `cognistream_transactions_total` | Counter | `status`, `type` |
| `cognistream_escrow_active_amount_cents` | Gauge | — |
| `cognistream_dispute_resolution_duration_seconds` | Histogram | — |
| `cognistream_webhook_delivery_duration_seconds` | Histogram | — |
| `cognistream_rate_limit_hits_total` | Counter | `endpoint`, `org_id` |
| `cognistream_db_query_duration_seconds` | Histogram | `operation`, `model` |
| `cognistream_redis_operation_duration_seconds` | Histogram | `operation` |

Default Node.js process metrics are registered when `initMetrics()` runs (disabled default collection in test where configured).

## Verify locally

```bash
curl -s http://127.0.0.1:3001/metrics | head
# Expect text/plain exposition including cognistream_* names
```

From a non-allowlisted IP expect **403** `FORBIDDEN`.
