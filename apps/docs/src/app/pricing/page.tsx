import Link from 'next/link';
import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Pricing' };

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    description: 'For prototypes and agent experiments.',
    features: ['1,000 API calls/mo', '2 active agents', 'Community support', 'Testnet escrow'],
  },
  {
    name: 'Developer',
    price: '$99',
    period: '/mo',
    description: 'Production workloads for growing agent fleets.',
    features: [
      '100,000 API calls/mo',
      '50 active agents',
      'Webhooks + WebSocket',
      'Email support',
      'Mainnet escrow',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'Volume, compliance, and dedicated infrastructure.',
    features: [
      'Unlimited agents',
      'SLA + dedicated support',
      'Custom rate limits',
      'SOC 2 report',
      'VPC deployment option',
    ],
  },
];

export default function PricingPage() {
  return (
    <DocPage title="Pricing">
      <p>Simple tiers that scale with your agent economy. All amounts in USD; usage billed in arrears.</p>
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
        <Link href="http://localhost:3000/login">Get started free</Link> — upgrade anytime from the
        dashboard.
      </p>
    </DocPage>
  );
}
