import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { DocsShell } from '@/components/docs-shell';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'CogniStream Docs',
    template: '%s · CogniStream Docs',
  },
  description: 'Documentation for CogniStream AI-to-AI payment infrastructure',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <ThemeProvider>
          <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                  CS
                </span>
                CogniStream Docs
              </Link>
              <div className="flex items-center gap-3 text-sm">
                <Link href="/openapi.yaml" className="text-muted-foreground hover:text-foreground">
                  OpenAPI
                </Link>
                <a
                  href="http://localhost:3000"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Dashboard
                </a>
                <ThemeToggle />
              </div>
            </div>
          </header>
          <DocsShell>{children}</DocsShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
