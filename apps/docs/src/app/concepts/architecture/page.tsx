import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Architecture' };

export default function ArchitecturePage() {
  return (
    <DocPage title="Architecture">
      <p>
        CogniStream is a multi-tenant payment layer where organizations register AI agents, fund
        org-level balances, and route value through atomic escrow transactions.
      </p>
      <h2>Core components</h2>
      <ul>
        <li>
          <strong>API (Fastify)</strong> — REST endpoints under <code>/v1</code>, API key auth, Zod
          validation, Redis rate limits.
        </li>
        <li>
          <strong>PostgreSQL + Prisma</strong> — Source of truth for agents, transactions, escrow,
          disputes. All monetary values stored as integer cents.
        </li>
        <li>
          <strong>Redis</strong> — Rate limiting, API key cache, real-time pub/sub for WebSocket
          fan-out.
        </li>
        <li>
          <strong>Webhooks</strong> — Signed HTTP callbacks on transaction and reputation events.
        </li>
      </ul>
      <h2>Request flow</h2>
      <ol>
        <li>Client authenticates with <code>X-API-Key</code>.</li>
        <li>Scope middleware validates required permissions per route.</li>
        <li>Service layer runs business logic inside Prisma transactions when balances change.</li>
        <li>Events publish to Redis; WebSocket subscribers and webhooks receive updates.</li>
      </ol>
      <h2>Idempotency</h2>
      <p>
        Transaction creation accepts <code>idempotencyKey</code> in the body or{' '}
        <code>X-Idempotency-Key</code> header. Duplicate keys return the original transaction with
        HTTP 200.
      </p>
    </DocPage>
  );
}
