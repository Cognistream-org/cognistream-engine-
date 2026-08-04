# Incident Response Runbook

**Last updated:** 2026-08-04  
**Related:** [escalation.md](./escalation.md) · [deployment.md](./deployment.md)

## Severity classification

| Severity | Definition | Response | Examples |
|----------|------------|----------|----------|
| **P0** | Complete outage or money-path corruption risk | Immediate page; all-hands until mitigated | API down; escrow double-spend; mass 5xx on `/v1/transactions`; encryption key loss |
| **P1** | Major degradation; revenue or trust impact | Page primary + secondary within 15m | Stripe webhooks failing >15m; circuit breaker open on `stripe`; DB failover |
| **P2** | Partial / workaround available | Business hours; ticket + SLO burn | Elevated latency; single-tenant quota bugs; non-critical webhook retries |
| **P3** | Cosmetic / low risk | Backlog | Docs, dashboards, non-prod only |

## First 15 minutes (any P0/P1)

1. **Acknowledge** the page; declare incident channel (`#inc-YYYYMMDD-short-name`).
2. **Stabilize communication:** one Incident Commander (IC), one Ops lead, one Comms.
3. **Triage symptoms**
   - `/health`, `/health/ready`, `/health/deep`
   - Prometheus: `cognistream_*`, Node defaults, error rate
   - Logs: requestId / traceId (no secrets, no PII)
   - Stripe Dashboard → Developers → Webhooks
4. **Contain**
   - Scale / restart unhealthy containers if crash-loop
   - Rate-limit or block abusive IPs at nginx if attack
   - Open circuit / pause Stripe Connect operations only with IC approval
5. **Decide:** mitigate in place vs [rollback](./deployment.md#rollback-summary)

## Rollback triggers

- Error rate >1% sustained 5+ minutes after deploy
- Incorrect monetary balances or fee miscalculation in production
- Failed migrations blocking ready probes
- Security regression (auth bypass, CORS wildcard, metrics publicly open)

## Communication template

```
INCIDENT: <title>
SEV: P0|P1|P2
IMPACT: <who / what % of traffic>
STATUS: Investigating | Mitigating | Monitoring | Resolved
NEXT UPDATE: <time UTC>
```

Customer-facing updates: no internal hostnames, no secret names, no customer PII.

## Resolution & postmortem

- [ ] User impact ended; monitors green for 2× MTTR window
- [ ] Root cause hypothesis documented
- [ ] Follow-ups filed (code, runbook, alert)
- [ ] P0/P1: blameless postmortem within 5 business days

## Quick links

| System | Where |
|--------|--------|
| API health | `GET /health`, `/health/ready`, `/health/deep` |
| Metrics | `GET /metrics` (IP allowlisted) |
| Stripe webhooks | Dashboard → Webhooks (see [stripe-webhook-failures.md](./stripe-webhook-failures.md)) |
| DB recovery | [database-recovery.md](./database-recovery.md) |
| On-call / vendors | [escalation.md](./escalation.md) |
