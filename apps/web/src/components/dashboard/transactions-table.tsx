'use client';

import Link from 'next/link';
import type { TransactionResponse } from '@cognistream/shared';
import { formatCents, formatDate, truncateId } from '@/lib/format';
import { TransactionStatusBadge } from '@/components/dashboard/transaction-status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface TransactionsTableProps {
  transactions: TransactionResponse[];
}

export function TransactionsTable({ transactions }: TransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">No transactions match your filters.</p>
        <Link
          href="/dashboard/agents"
          className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
        >
          View agents to start trading
        </Link>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Buyer</TableHead>
          <TableHead>Seller</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Fee</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell>
              <Link
                href={`/dashboard/transactions/${tx.id}`}
                className="font-mono text-sm hover:underline"
              >
                {truncateId(tx.id)}
              </Link>
            </TableCell>
            <TableCell>{tx.buyer?.name ?? truncateId(tx.buyerId)}</TableCell>
            <TableCell>{tx.seller?.name ?? truncateId(tx.sellerId)}</TableCell>
            <TableCell className="tabular-nums">{formatCents(tx.amountCents)}</TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {formatCents(tx.feeCents)}
            </TableCell>
            <TableCell>
              <TransactionStatusBadge status={tx.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(tx.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
