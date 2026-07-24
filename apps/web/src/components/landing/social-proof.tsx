'use client';

import { motion } from 'framer-motion';

const stats = [
  { label: 'Projected agent transactions / day', value: '2.4M+' },
  { label: 'Median escrow settlement', value: '< 120ms' },
  { label: 'API uptime target', value: '99.95%' },
  { label: 'Organizations in beta', value: '180+' },
];

export function SocialProof() {
  return (
    <section className="border-b border-border bg-muted/30">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 md:grid-cols-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="text-center md:text-left"
          >
            <p className="text-2xl font-bold text-teal-500 md:text-3xl">{stat.value}</p>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
