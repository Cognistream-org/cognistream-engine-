'use client';

import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
            CS
          </span>
          CogniStream
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="http://localhost:3002"
            className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
          >
            Docs
          </a>
          <ThemeToggle />
          <Button asChild size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
            <Link href="/login">Get API Key</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
