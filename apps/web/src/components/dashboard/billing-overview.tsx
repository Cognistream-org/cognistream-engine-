'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  fetchBillingProfile,
  fetchBillingUsage,
  fetchInvoices,
  proxyUrl,
} from '@/lib/api';
import { formatCents, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

const METER_LABELS: Record<string, string> = {
  api_calls: 'API calls',
  transactions: 'Transactions',
  transaction_volume_cents: 'Transaction volume',
  agents: 'Agents',
  webhooks: 'Webhooks',
  disputes: 'Disputes',
};

function meterPercent(usage: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

export function BillingOverview() {
  const { data: profile, isLoading: profileLoading } = useSWR(
    proxyUrl('v1/billing/profile'),
    () => fetchBillingProfile(),
  );
  const { data: usage, isLoading: usageLoading } = useSWR(proxyUrl('v1/billing/usage'), () =>
    fetchBillingUsage(),
  );
  const { data: invoices } = useSWR(proxyUrl('v1/billing/invoices?limit=1'), () =>
    fetchInvoices({ limit: '1' }),
  );

  const nextInvoice = invoices?.data[0];
  const loading = profileLoading || usageLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-muted-foreground">Plan, usage, and upcoming invoices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/billing/usage">Usage</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/billing/invoices">Invoices</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/billing/connect">Stripe Connect</Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/billing/upgrade">Upgrade</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>Organization subscription tier</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <Skeleton className="h-10 w-40" />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-semibold capitalize">
                    {profile?.organization.tier ?? 'free'}
                  </span>
                  {profile?.subscription ? (
                    <Badge variant="secondary">{profile.subscription.status}</Badge>
                  ) : (
                    <Badge variant="outline">No subscription</Badge>
                  )}
                </div>
                {profile?.subscription && (
                  <p className="text-sm text-muted-foreground">
                    Period ends {formatDate(profile.subscription.currentPeriodEnd)}
                    {profile.subscription.cancelAtPeriodEnd ? ' · Cancels at period end' : ''}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {formatCents(profile?.pricing.monthlyPriceCents ?? 0)} / month
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next invoice</CardTitle>
            <CardDescription>Most recent invoice on file</CardDescription>
          </CardHeader>
          <CardContent>
            {nextInvoice ? (
              <div className="space-y-1">
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCents(nextInvoice.amountDueCents)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {nextInvoice.invoiceNumber} · {nextInvoice.status}
                  {nextInvoice.dueDate ? ` · due ${formatDate(nextInvoice.dueDate)}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage this period</CardTitle>
          <CardDescription>
            {usage ? `Billing period ${usage.billingPeriod}` : 'Current billing period'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !usage ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            Object.entries(usage.meters).map(([key, meter]) => {
              const label = METER_LABELS[key] ?? key;
              const value =
                key === 'transaction_volume_cents'
                  ? `${formatCents(meter.usage)} / ${formatCents(meter.limit)}`
                  : `${meter.usage.toLocaleString()} / ${meter.limit.toLocaleString()}`;
              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{label}</span>
                    <span className="tabular-nums text-muted-foreground">{value}</span>
                  </div>
                  <Progress value={meterPercent(meter.usage, meter.limit)} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
