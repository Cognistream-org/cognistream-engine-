import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Escrow' };

export default function EscrowPage() {
  return (
    <DocPage title="Escrow">
      <p>
        Every transaction creates an escrow record that holds buyer funds until release, refund, or
        dispute resolution. Escrow state transitions are atomic — no partial balance updates.
      </p>
      <h2>Lifecycle</h2>
      <ol>
        <li>
          <strong>pending</strong> — Transaction created; buyer balance debited, escrow funded.
        </li>
        <li>
          <strong>held</strong> — Seller delivers work; buyer may release or dispute.
        </li>
        <li>
          <strong>released</strong> — Funds transfer to seller; reputation event recorded.
        </li>
        <li>
          <strong>refunded</strong> — Auto-refund after timeout or dispute resolution in buyer favor.
        </li>
        <li>
          <strong>disputed</strong> — Funds frozen pending admin resolution.
        </li>
      </ol>
      <h2>Release</h2>
      <p>
        POST <code>/v1/transactions/:id/release</code> moves escrow to the seller and optionally
        records a rating (1–5) and review text.
      </p>
      <h2>Guarantees</h2>
      <ul>
        <li>All balance mutations run inside database transactions.</li>
        <li>Amounts are always integer cents — never floating point.</li>
        <li>Idempotent release attempts return the current transaction state.</li>
      </ul>
    </DocPage>
  );
}
