# Stripe Webhook Failures Runbook

**Endpoint:** `POST /v1/webhooks/stripe`  
**Last updated:** 2026-08-04

## Symptoms

- Stripe Dashboard shows delivery failures (4xx/5xx) or high retry count
- Subscriptions / invoices / Connect accounts out of sync with DB
- Circuit breaker open for `stripe_webhook` (failure threshold **10**)
- Spike in API 429 on webhook path (IP rate limit)

## Architecture notes (current)

| Mechanism | Behavior |
|-----------|----------|
| Signature | `stripe-signature` + raw body vs `STRIPE_WEBHOOK_SECRET` → **400** `INVALID_SIGNATURE` |
| Idempotency | Redis `stripe-event:{event.id}` — duplicates return **200** `{ duplicate: true }` |
| Retries | In-process `withRetry` (~4 attempts non-test) + circuit breaker |
| IP limit | `enforceStripeWebhookIpLimit` (100/min/IP prod; higher in test) |
| Platform fee transfer retry | Redis flag `cognistream:platform-fee:retry:{transactionId}` TTL 24h |
| **DLQ** | **Not implemented** — rely on Stripe Dashboard automatic retries + manual replay |

## Debug steps

1. **Stripe Dashboard → Developers → Webhooks → [endpoint] → Attempts**
   - Note HTTP status, event id, event type, timestamp.
2. **Local / API logs** — filter by `requestId` / event id (never log secrets or full payloads with PII).
3. **Classify failure**

| Status | Likely cause | Action |
|--------|--------------|--------|
| 400 `INVALID_SIGNATURE` | Wrong `STRIPE_WEBHOOK_SECRET`, body parsed before verify, proxy altered body | Fix secret; ensure raw body; rotate webhook secret in Stripe + env together |
| 429 | IP rate limit | Confirm Stripe egress IPs not shared behind noisy NAT; temporarily raise limit only with security review |
| 5xx | DB/Redis down, unhandled exception, breaker open | Fix deps; restart API; check `/health/ready` |
| 200 but state wrong | Handler bug / wrong event type | Fix code; **Resend** event from Dashboard |

4. **Circuit breaker** — if `stripe_webhook` is open, wait reset window (~30s) or restart process after root cause fix; avoid thundering herd of manual replays.
5. **Replay**
   - Stripe Dashboard → event → **Resend**
   - Prefer single-event replay; confirm idempotency key absorbs duplicates

## Platform fee / transfer failures

If Connect `transfer.failed` (or retry flag present):

1. Inspect Redis key `cognistream:platform-fee:retry:{transactionId}`.
2. Verify Connect account status and Stripe balance.
3. After fix, clear flag only when a controlled retry path is run (avoid double transfer).

## Recovery checklist

- [ ] Webhook secret matches Stripe endpoint
- [ ] Recent events show 200
- [ ] Subscription / invoice rows match Stripe for sample orgs
- [ ] No unbounded growth of failed attempts in Dashboard
- [ ] Incident severity set per [incident-response.md](./incident-response.md)

## Prevention

- Alert on webhook 4xx/5xx rate and breaker state
- Keep `STRIPE_WEBHOOK_SECRET` in secrets manager; rotate with dual-secret cutover when possible
- Load-test webhook ingestion: `infra/load-tests/webhook-load.js`
