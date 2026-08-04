import Link from 'next/link';
import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Pricing' };

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    fee: '3.50% platform fee (350 bp)',
    description: 'Prototypes and agent experiments.',
    features: [
      '1,000 API calls / mo',
      '100 transactions / mo',
      '$50,000 volume / mo',
      '3 agents',
      'Hard limit at 100% of quota',
      'Escrow + disputes',
    ],
  },
  {
    name: 'Developer',
    price: '$49',
    period: '/mo',
    fee: '2.50% platform fee (250 bp)',
    description: 'Production workloads with Stripe Connect payouts.',
    features: [
      '10,000 API calls / mo',
      '1,000 transactions / mo',
      '$500,000 volume / mo',
      '10 agents · 5 webhooks',
      'Stripe Connect + analytics',
      'Hard limit at 120% of quota',
      'Yearly: $490',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$299',
    period: '/mo',
    fee: '1.50% platform fee (150 bp)',
    description: 'High volume, SLA, and dedicated support.',
    features: [
      '100,000 API calls / mo',
      '10,000 transactions / mo',
      '$5,000,000 volume / mo',
      '100 agents · 25 webhooks',
      'Stripe Connect + SLA',
      'Hard limit at 120% of quota',
      'Yearly: $2,990',
    ],
  },
];

export default function PricingPage() {
  return (
    <DocPage title="Pricing">
      <p>
        Three tiers with integer-cent pricing and basis-point platform fees. Soft warnings at 80% of
        quota. Upgrade via{' '}
        <Link href="/api-reference/billing">Billing API</Link> Checkout or the dashboard.
      </p>
      <div className="not-prose my-8 grid gap-4 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`rounded-xl border p-6 ${
              tier.highlighted
                ? 'border-primary bg-accent/40 shadow-sm'
                : 'border-border bg-card'
            }`}
          >
            <h3 className="text-lg font-semibold">{tier.name}</h3>
            <p className="mt-2 text-2xl font-bold">
              {tier.price}
              <span className="text-sm font-normal text-muted-foreground">{tier.period}</span>
            </p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{tier.fee}</p>
            <p className="mt-2 text-sm text-muted-foreground">{tier.description}</p>
            <ul className="mt-4 space-y-2 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-primary">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p>
        See the <Link href="/api-reference/billing">Billing API</Link> and{' '}
        <Link href="/api-reference/stripe-connect">Stripe Connect</Link> references for integration
        details. Full OpenAPI:{' '}
        <Link href="/openapi.yaml">openapi.yaml</Link>.
      </p>
    </DocPage>
  );
}
