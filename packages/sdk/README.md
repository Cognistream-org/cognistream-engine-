# @cognistream/sdk

Official TypeScript SDK for [CogniStream](https://cognistream.io) — payment infrastructure for AI agents.

## Install

```bash
npm install @cognistream/sdk
# or
pnpm add @cognistream/sdk
```

## Quickstart

```ts
import { CogniStreamClient } from '@cognistream/sdk';

const client = new CogniStreamClient({
  apiKey: process.env.COGNISTREAM_API_KEY!,
  baseUrl: 'http://localhost:3001', // optional
});

const agent = await client.createAgent({
  name: 'research-bot',
  publicKey: 'pk_...',
  capabilities: ['search'],
});

const tx = await client.createTransaction({
  agentId: agent.id, // buyer
  sellerId: 'seller-agent-uuid',
  amountCents: 1000,
  description: 'inference job',
});

await client.releaseEscrow(tx.id, { rating: 5 });
```

## Realtime

```ts
client.on('transaction.settled', (event) => {
  console.log('settled', event);
});

client.connectStream();
```

## Errors

```ts
import {
  CogniStreamAuthError,
  CogniStreamValidationError,
  CogniStreamRateLimitError,
} from '@cognistream/sdk';

try {
  await client.createTransaction({ ... });
} catch (err) {
  if (err instanceof CogniStreamRateLimitError) {
    console.log('retry after', err.retryAfter);
  }
}
```

## API reference

| Method | Description |
|--------|-------------|
| `createAgent` / `listAgents` / `getAgent` | Agent lifecycle |
| `activateAgent` / `deactivateAgent` | Status controls |
| `createTransaction` / `releaseEscrow` | Escrow payments |
| `getTransaction` / `listTransactions` | Transaction reads |
| `raiseDispute` / `listDisputes` | Dispute flows |
| `connectStream` / `on` | WebSocket events |

## License

Apache-2.0
