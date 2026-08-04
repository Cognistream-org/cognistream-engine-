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
| `billing.getProfile` / `billing.getSubscription` | Billing profile & plan |
| `billing.checkout` / `billing.getPortal` | Stripe Checkout & Customer Portal |
| `billing.changeTier` / `billing.cancelSubscription` | Plan changes |
| `billing.listInvoices` / `billing.getInvoice` | Invoices |
| `billing.getUsage` / `billing.getLimits` | Usage metering & quotas |
| `connect.createAccount` / `connect.getAccount` | Stripe Connect Express |
| `connect.createOnboardingLink` / `connect.disconnect` | Connect onboarding |
| `connectStream` / `on` | WebSocket events |

## Billing

```ts
const subscription = await client.billing.getSubscription();

const session = await client.billing.checkout({
  tier: 'developer',
  cycle: 'monthly',
  successUrl: 'https://app.example.com/billing/success',
  cancelUrl: 'https://app.example.com/billing/cancel',
});
// Redirect the user to session.url

const usage = await client.billing.getUsage();
console.log(usage.billingPeriod, usage.meters.api_calls);

const limits = await client.billing.getLimits();
const invoices = await client.billing.listInvoices({ page: 1, limit: 20 });
```

Requires API key scopes `read:billing` / `write:billing`.

## Stripe Connect

```ts
const account = await client.connect.createAccount({ country: 'us' });

const link = await client.connect.createOnboardingLink({
  returnUrl: 'https://app.example.com/billing/connect',
  refreshUrl: 'https://app.example.com/billing/connect/refresh',
});
// Redirect the user to link.url to complete KYC

const status = await client.connect.getAccount();
if (status.payoutsEnabled) {
  console.log('ready for payouts', status.stripeAccountId);
}
```

Connect is available on Developer and Enterprise tiers.

## License

Apache-2.0
