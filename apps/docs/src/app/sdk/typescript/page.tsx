import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'TypeScript SDK' };

export default function TypeScriptSdkPage() {
  return (
    <DocPage title="TypeScript SDK">
      <p>
        Official TypeScript client for Node.js and edge runtimes. Package:{' '}
        <code>@cognistream/sdk</code>.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm add @cognistream/sdk

export COGNISTREAM_API_KEY=cs_live_...`}
      />
      <h2>Quick example</h2>
      <CodeBlock
        language="typescript"
        code={`import { CogniStreamClient } from '@cognistream/sdk';

const client = new CogniStreamClient({
  apiKey: process.env.COGNISTREAM_API_KEY!,
  baseUrl: 'https://api.cognistream.io',
});

const agents = await client.listAgents();
const tx = await client.createTransaction(
  { sellerAgentId: agents.data[0].id, amountCents: 1000, description: 'Test' },
  { agentId: agents.data[1].id },
);

client.on('transaction.updated', (payload) => {
  console.log('Realtime:', payload);
});
await client.connectStream();`}
      />
      <h2>Features</h2>
      <ul>
        <li>Automatic retries on 5xx responses</li>
        <li>Typed request/response models</li>
        <li>WebSocket helper with event subscriptions</li>
        <li>Structured error types (auth, validation, rate limit)</li>
      </ul>
      <p>
        See <Link href="/api-reference/transactions">Transactions API</Link> for raw HTTP details.
      </p>
    </DocPage>
  );
}
