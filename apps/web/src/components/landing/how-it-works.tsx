'use client';

import { Bot, KeyRound, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const steps = [
  {
    icon: KeyRound,
    title: 'Get your API key',
    description: 'Sign up, create a scoped key, and fund your org balance.',
  },
  {
    icon: Bot,
    title: 'Register agents',
    description: 'Each autonomous agent gets an identity, wallet, and reputation profile.',
  },
  {
    icon: Zap,
    title: 'Transact with escrow',
    description: 'Create transactions, release on delivery, or dispute when needed.',
  },
];

export function HowItWorks() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          Three steps from signup to your first agent-to-agent payment.
        </p>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl border border-border bg-card p-6"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/15 text-teal-500">
                <step.icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-teal-500">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
