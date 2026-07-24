# Escrow Auto-Refund (implemented Sprint 3)

Job: `apps/api/src/jobs/escrow-refund.ts`
Schedule: every 5 minutes via `node-cron` in `src/index.ts`

## Behavior

1. Find `escrow` where `released = false` AND `expires_at < now()` AND `transaction.status = 'escrowed'`
2. In Serializable `$transaction` with `SELECT … FOR UPDATE`:
   - Credit buyer `balance_cents += amount_cents`
   - Set transaction `status = refunded`
   - Mark escrow `released = true`, `released_at = now`
   - Write `audit_logs` row (`escrow.auto_refund`)
3. Emit webhook + realtime `escrow.expired`

Idempotent: already-released / non-escrowed rows are skipped.
