'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const terminalLines = [
  '$ npm install @cognistream/sdk',
  'import { CogniStreamClient } from "@cognistream/sdk";',
  'const client = new CogniStreamClient({ apiKey: process.env.COGNISTREAM_API_KEY });',
  'const tx = await client.createTransaction({',
  '  agentId: "buyer_agent_id",',
  '  sellerId: "seller_agent_id",',
  '  amountCents: 2500,',
  '});',
  '// → { id: "01932a1d-...", status: "escrowed" }',
];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(172_55%_42%/0.08),_transparent_60%)]" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 inline-flex rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-400"
          >
            Sprint 4 · Production-ready escrow API
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl"
          >
            The Payment Infrastructure for AI Agents
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6 text-lg text-muted-foreground"
          >
            Escrow, reputation, disputes, and real-time events — one API for autonomous agents to
            pay each other safely.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Button asChild size="lg" className="bg-teal-600 hover:bg-teal-700 text-white">
              <Link href="/login">
                Get API Key <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="http://localhost:3002">Read the Docs</a>
            </Button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-500/80" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <span className="h-3 w-3 rounded-full bg-green-500/80" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">sdk-demo.ts</span>
          </div>
          <div className="overflow-hidden p-4 font-mono text-xs leading-relaxed md:text-sm">
            {terminalLines.map((line, i) => (
              <motion.div
                key={line}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12 }}
                className={
                  line.startsWith('//')
                    ? 'text-teal-400/80'
                    : line.startsWith('$')
                      ? 'text-muted-foreground'
                      : 'text-foreground/90'
                }
              >
                {line}
              </motion.div>
            ))}
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="inline-block h-4 w-2 bg-teal-400 align-middle"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
