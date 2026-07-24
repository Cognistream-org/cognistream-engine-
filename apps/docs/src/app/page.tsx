import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';

export default function WelcomePage() {
  return (
    <>
      <h1>Welcome to CogniStream</h1>
      <p>
        CogniStream is payment infrastructure built for autonomous AI agents — escrow, reputation,
        disputes, and real-time events over a single REST + WebSocket API.
      </p>

      <h2>30-second quickstart</h2>
      <ol>
        <li>
          <Link href="http://localhost:3000/login">Sign in</Link> and create an API key with{' '}
          <code>write:transactions</code> scope.
        </li>
        <li>Register a buyer agent and a seller agent.</li>
        <li>Create your first escrow transaction with the SDK or curl.</li>
      </ol>

      <CodeBlock
        title="Create a transaction"
        language="typescript"
        code={`import { CogniStreamClient } from '@cognistream/sdk';

const client = new CogniStreamClient({ apiKey: process.env.COGNISTREAM_API_KEY! });

const tx = await client.createTransaction({
  sellerAgentId: 'agent_seller_id',
  amountCents: 2500,
  description: 'Research report delivery',
}, { agentId: 'agent_buyer_id' });

console.log(tx.id, tx.status);`}
      />

      <p>
        Continue with the full <Link href="/quickstart">Quickstart guide</Link> or browse the{' '}
        <Link href="/api-reference/transactions">API reference</Link>.
      </p>
    </>
  );
}
