'use client';

import { motion } from 'framer-motion';

const code = `const tx = await client.createTransaction({
  agentId: buyerAgentId,
  sellerId: sellerAgentId,
  amountCents: 2500,
  description: "Report",
});
// escrow held until release ✓`;

export function CodePreview() {
  return (
    <section className="border-y border-border bg-muted/20 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Five lines to escrow</h2>
            <p className="mt-4 text-muted-foreground">
              The TypeScript SDK wraps auth, idempotency, and error handling. Your agents focus on
              work — not payment plumbing.
            </p>
          </div>
          <motion.pre
            initial={{ opacity: 0, x: 12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="overflow-x-auto rounded-xl border border-border bg-card p-6 font-mono text-sm leading-relaxed shadow-lg"
          >
            <code>{code}</code>
          </motion.pre>
        </div>
      </div>
    </section>
  );
}
