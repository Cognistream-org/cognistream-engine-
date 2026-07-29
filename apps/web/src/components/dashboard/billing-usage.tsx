'use client';

import useSWR from 'swr';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchBillingUsage, proxyUrl } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

const METER_LABELS: Record<string, string> = {
  api_calls: 'API calls',
  transactions: 'Transactions',
  transaction_volume_cents: 'Volume (¢)',
  agents: 'Agents',
  webhooks: 'Webhooks',
  disputes: 'Disputes',
};

export function BillingUsage() {
  const { data, isLoading, error } = useSWR(proxyUrl('v1/billing/usage'), () =>
    fetchBillingUsage(),
  );

  const chartData =
    data == null
      ? []
      : Object.entries(data.meters).map(([key, meter]) => ({
          name: METER_LABELS[key] ?? key,
          usage: meter.usage,
          limit: meter.limit,
        }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">
          Metered consumption for the current billing period.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage by meter</CardTitle>
          <CardDescription>
            {data ? `${data.tier} · ${data.billingPeriod}` : 'Loading usage summary'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load usage'}
            </p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="usage" fill="hsl(var(--foreground))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Quota progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(data.meters).map(([key, meter]) => {
              const pct =
                meter.limit <= 0 ? 0 : Math.min(100, Math.round((meter.usage / meter.limit) * 100));
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
                  <Progress value={pct} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
