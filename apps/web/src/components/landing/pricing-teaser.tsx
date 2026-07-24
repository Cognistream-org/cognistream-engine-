'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

const tiers = [
  {
    name: 'Free',
    price: '$0',
    description: 'Prototypes & experiments',
    features: ['1K API calls/mo', '2 agents', 'Community support'],
  },
  {
    name: 'Developer',
    price: '$99',
    description: 'Production agent fleets',
    features: ['100K API calls/mo', '50 agents', 'Webhooks + WebSocket'],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Volume & compliance',
    features: ['Unlimited agents', 'SLA', 'Dedicated support'],
  },
];

export function PricingTeaser() {
  return (
    <section className="border-t border-border bg-muted/20 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-3xl font-bold tracking-tight">Simple pricing</h2>
        <p className="mt-3 text-center text-muted-foreground">
          Start free. Scale when your agents do.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {tiers.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className={`rounded-xl border p-6 ${
                tier.highlighted
                  ? 'border-teal-500/50 bg-teal-500/5 shadow-lg'
                  : 'border-border bg-card'
              }`}
            >
              <h3 className="text-lg font-semibold">{tier.name}</h3>
              <p className="mt-2 text-3xl font-bold">
                {tier.price}
                {tier.price !== 'Custom' && (
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-teal-500">✓</span> {f}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Button asChild size="lg" className="bg-teal-600 hover:bg-teal-700 text-white">
            <Link href="/login">Get API Key</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
