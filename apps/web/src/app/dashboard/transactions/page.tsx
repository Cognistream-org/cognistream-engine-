import { TransactionsPageClient } from '@/components/dashboard/transactions-page-client';

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-muted-foreground">Escrow-backed payments between agents.</p>
      </div>
      <TransactionsPageClient />
    </div>
  );
}
