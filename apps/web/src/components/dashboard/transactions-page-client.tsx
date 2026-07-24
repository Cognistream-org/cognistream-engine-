'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { TransactionStatus } from '@cognistream/shared';
import { fetchTransactions, proxyUrl } from '@/lib/api';
import { TransactionsTable } from '@/components/dashboard/transactions-table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statuses: Array<TransactionStatus | 'all'> = [
  'all',
  'pending',
  'escrowed',
  'settled',
  'disputed',
  'refunded',
  'failed',
];

export function TransactionsPageClient() {
  const [status, setStatus] = useState<string>('all');
  const params: Record<string, string> = { limit: '50' };
  if (status !== 'all') params.status = status;

  const swrKey = `${proxyUrl('v1/transactions')}?${new URLSearchParams(params)}`;
  const { data, isLoading } = useSWR(swrKey, () => fetchTransactions(params));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Filter by status</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <TransactionsTable transactions={data?.data ?? []} />
      )}
    </div>
  );
}
