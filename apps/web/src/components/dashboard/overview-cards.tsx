'use client';

import type { ComponentType } from 'react';
import useSWR from 'swr';
import { Activity, Bot, DollarSign, Receipt } from 'lucide-react';
import { fetchOverview, proxyUrl } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewCards() {
  const { data, isLoading } = useSWR(proxyUrl('v1/overview'), () => fetchOverview());

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Transactions this month"
        value={String(data?.stats.transactionsThisMonth ?? 0)}
        icon={Receipt}
        loading={isLoading}
      />
      <StatCard
        title="Volume this month"
        value={formatCents(data?.stats.volumeCentsThisMonth ?? 0)}
        icon={DollarSign}
        loading={isLoading}
      />
      <StatCard
        title="Active agents"
        value={String(data?.stats.activeAgents ?? 0)}
        icon={Bot}
        loading={isLoading}
      />
      <StatCard
        title="Org balance"
        value={formatCents(data?.organization.balanceCents ?? 0)}
        icon={Activity}
        loading={isLoading}
      />
    </div>
  );
}
