# Escalation & On-Call

**Last updated:** 2026-08-04  
**Related:** [incident-response.md](./incident-response.md)

> Replace placeholder contacts with your production roster before go-live. Do not commit personal phone numbers to public forks — use a private ops vault and mirror roles here.

## On-call rotation

| Role | Responsibility | Schedule |
|------|----------------|----------|
| **Primary** | First responder for P0/P1 pages | Weekly rotation (Mon 12:00 UTC) |
| **Secondary** | Backup if primary ACK misses 5 minutes | Same rotation, offset |
| **Incident Commander** | Declared on P0; coordinates mitigate/comms | On-demand from eng leads |
| **Comms** | Status page / customer updates | On-demand |

**Handoff:** Primary posts handoff note (open incidents, risky deploys, Stripe mode) in `#ops-handoff` before going off-shift.

## Internal contacts (placeholders)

| Function | Contact | Channel |
|----------|---------|---------|
| Eng on-call primary | `oncall-primary@cognistream.example` | Pager / Slack `#oncall` |
| Eng on-call secondary | `oncall-secondary@cognistream.example` | Pager |
| Security | `security@cognistream.example` | `#security` |
| Founders / exec sponsor | `exec-oncall@cognistream.example` | P0 only |

## Vendor contacts

### Stripe

| Need | Where |
|------|--------|
| Dashboard | https://dashboard.stripe.com |
| Support | Dashboard → **Help** → Contact support (use account with production access) |
| Status | https://status.stripe.com |
| Webhooks | Developers → Webhooks |
| Security / account compromise | Stripe support **Priority** + rotate API keys / webhook secrets immediately |

When opening Stripe tickets, include: account id (`acct_…`), event ids, approximate UTC window, and that CogniStream uses Connect + Billing webhooks (`/v1/webhooks/stripe`). **Never** paste secret keys or webhook signing secrets into tickets.

### Infrastructure (fill per environment)

| Vendor | Use | Contact / console |
|--------|-----|-------------------|
| Cloud provider | Compute / networking | _TBD_ |
| Managed Postgres | PITR / failover | _TBD_ |
| DNS / CDN | Cutover / TLS | _TBD_ |
| Error tracking | Exceptions | _TBD_ |
| Status page | External comms | _TBD_ |

## Escalation ladder

```
Minute 0     Primary paged (P0/P1)
Minute 5     Secondary if no ACK
Minute 15    Eng lead / IC + Stripe status check if payments involved
Minute 30    Exec sponsor (P0 unresolved) + customer comms draft
Hour 1+      Vendor bridge (Stripe / cloud) as needed
```

## After-hours rules

- P2/P3: do not page; ticket for next business day unless burn rate threatens SLO.
- P0 money-path: page even if “maybe transient”; cancel after ACK if health recovers.
