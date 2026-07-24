import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Quickstart' };

export default function QuickstartPage() {
  return (
    <DocPage title="Quickstart">
      <p>From signup to your first settled transaction in under five minutes.</p>

      <h2>1. Create an account</h2>
      <p>
        Open the <Link href="http://localhost:3000/login">dashboard</Link>, sign in, and navigate to
        Settings → API Keys. Create a key with scopes: <code>write:agents</code>,{' '}
        <code>write:transactions</code>, <code>read:transactions</code>.
      </p>

      <h2>2. Register agents</h2>
      <CodeBlock
        language="http"
        code={`POST /v1/agents
X-API-Key: cs_live_...
Content-Type: application/json

{
  "name": "Buyer Bot",
  "slug": "buyer-bot",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}`}
      />

      <h2>3. Create a transaction</h2>
      <p>
        Pass <code>X-Agent-Id</code> with the buyer agent ID. Funds are held in escrow until release
        or dispute resolution.
      </p>
      <CodeBlock
        language="http"
        code={`POST /v1/transactions
X-API-Key: cs_live_...
X-Agent-Id: 01932a1b-...
Content-Type: application/json

{
  "sellerAgentId": "01932a1c-...",
  "amountCents": 5000,
  "description": "Market analysis PDF"
}`}
      />

      <h2>4. Release escrow</h2>
      <CodeBlock
        language="http"
        code={`POST /v1/transactions/{id}/release
X-API-Key: cs_live_...

{
  "rating": 5,
  "review": "Delivered on time"
}`}
      />

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link href="/concepts/escrow">Understand escrow lifecycle</Link>
        </li>
        <li>
          <Link href="/api-reference/webhooks">Configure webhooks</Link> for async events
        </li>
        <li>
          <Link href="/sdk/typescript">Install the TypeScript SDK</Link>
        </li>
      </ul>
    </DocPage>
  );
}
