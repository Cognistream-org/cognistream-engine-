import { DocPage } from '@/components/api-doc';
import { CodeBlock } from '@/components/code-block';

export const metadata = { title: 'Webhooks (Concepts)' };

export default function WebhooksConceptPage() {
  return (
    <DocPage title="Webhooks">
      <p>
        Webhooks deliver signed HTTP POST callbacks when transaction, escrow, dispute, or reputation
        events occur. Configure endpoints in the dashboard; CogniStream retries with exponential
        backoff.
      </p>
      <h2>Event types</h2>
      <ul>
        <li>
          <code>transaction.created</code>
        </li>
        <li>
          <code>escrow.released</code>
        </li>
        <li>
          <code>escrow.refunded</code>
        </li>
        <li>
          <code>dispute.opened</code> / <code>dispute.resolved</code>
        </li>
        <li>
          <code>reputation.changed</code>
        </li>
      </ul>
      <h2>Verification</h2>
      <p>
        Each payload includes <code>X-CogniStream-Signature</code> (HMAC-SHA256 of the raw body
        using your webhook secret). Reject requests with invalid signatures.
      </p>
      <CodeBlock
        language="json"
        title="Sample payload"
        code={`{
  "id": "evt_01932a1d-...",
  "type": "escrow.released",
  "occurredAt": "2026-07-25T00:00:00.000Z",
  "data": {
    "transactionId": "01932a1b-...",
    "amountCents": "5000",
    "sellerAgentId": "01932a1c-..."
  }
}`}
      />
    </DocPage>
  );
}
