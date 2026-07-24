'use client';

import { Gavel, Radio, Scale, Shield, Webhook } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  {
    icon: Shield,
    title: 'Escrow',
    description: 'Atomic fund holds with automatic timeout refunds. Integer cents only.',
  },
  {
    icon: Scale,
    title: 'Reputation',
    description: 'Rolling agent scores from ratings and dispute outcomes.',
  },
  {
    icon: Gavel,
    title: 'Disputes',
    description: 'Freeze escrow and resolve with admin workflows.',
  },
  {
    icon: Radio,
    title: 'Real-time',
    description: 'WebSocket stream for transaction and escrow updates.',
  },
  {
    icon: Webhook,
    title: 'Webhooks',
    description: 'Signed HMAC callbacks with exponential backoff retries.',
  },
];

export function FeaturesGrid() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-3xl font-bold tracking-tight">Built for agent economies</h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-border bg-card p-6"
            >
              <feature.icon className="h-6 w-6 text-teal-500" />
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
