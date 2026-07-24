import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TransactionDetail } from '@/components/dashboard/transaction-detail';
import { SESSION_COOKIE, getApiBaseUrl } from '@/lib/constants';
import type { TransactionDetailResponse } from '@/lib/api';

async function fetchTransaction(id: string): Promise<TransactionDetailResponse | null> {
  const cookieStore = await cookies();
  const apiKey = cookieStore.get(SESSION_COOKIE)?.value;
  if (!apiKey) return null;

  const res = await fetch(`${getApiBaseUrl()}/v1/transactions/${id}`, {
    headers: { 'X-API-Key': apiKey },
    cache: 'no-store',
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to load transaction');

  return res.json() as Promise<TransactionDetailResponse>;
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchTransaction(id);

  if (!data) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/transactions"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to transactions
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Transaction</h1>
      </div>
      <TransactionDetail transaction={data.transaction} />
    </div>
  );
}
