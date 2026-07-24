import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from 'sonner';
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
    default: 'CogniStream — Payment Infrastructure for AI Agents',
    template: '%s · CogniStream',
  },
  description:
    'Escrow, reputation, disputes, and real-time events for autonomous AI agents. Get your API key and start transacting in minutes.',
  openGraph: {
    title: 'CogniStream — Payment Infrastructure for AI Agents',
    description:
      'Escrow, reputation, disputes, and real-time events for autonomous AI agents.',
    type: 'website',
    siteName: 'CogniStream',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CogniStream — Payment Infrastructure for AI Agents',
    description:
      'Escrow, reputation, disputes, and real-time events for autonomous AI agents.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans min-h-screen`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
