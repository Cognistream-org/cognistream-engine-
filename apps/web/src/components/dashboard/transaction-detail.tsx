import type { TransactionStatus } from '@cognistream/shared';
import { formatCents, formatDate } from '@/lib/format';
import { TransactionStatusBadge } from '@/components/dashboard/transaction-status-badge';
import { ReleaseEscrowButton } from '@/components/dashboard/release-escrow-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { TransactionResponse } from '@cognistream/shared';

interface TimelineStep {
  label: string;
  at: string | null;
  done: boolean;
}

function buildTimeline(tx: TransactionResponse): TimelineStep[] {
  const escrowed = tx.status !== 'pending' && tx.status !== 'failed';
  const terminal = ['settled', 'refunded', 'failed'].includes(tx.status);

  return [
    { label: 'Created', at: tx.createdAt, done: true },
    {
      label: 'Escrowed',
      at: tx.escrow?.expiresAt ?? null,
      done: escrowed,
    },
    {
      label: tx.status === 'refunded' ? 'Refunded' : tx.status === 'failed' ? 'Failed' : 'Settled',
      at: tx.settledAt,
      done: terminal,
    },
  ];
}

export function TransactionDetail({ transaction }: { transaction: TransactionResponse }) {
  const timeline = buildTimeline(transaction);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-lg">{transaction.id}</CardTitle>
              <TransactionStatusBadge status={transaction.status} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Buyer</p>
              <p className="font-medium">{transaction.buyer?.name ?? transaction.buyerId}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Seller</p>
              <p className="font-medium">{transaction.seller?.name ?? transaction.sellerId}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-xl font-semibold tabular-nums">
                {formatCents(transaction.amountCents)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Fee</p>
              <p className="tabular-nums">{formatCents(transaction.feeCents)}</p>
            </div>
            {transaction.description ? (
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Description</p>
                <p>{transaction.description}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {timeline.map((step, i) => (
                <li key={step.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-3 w-3 rounded-full border-2 ${
                        step.done ? 'border-foreground bg-foreground' : 'border-muted-foreground'
                      }`}
                    />
                    {i < timeline.length - 1 ? (
                      <div className={`w-px flex-1 ${step.done ? 'bg-foreground' : 'bg-border'}`} />
                    ) : null}
                  </div>
                  <div className="pb-4">
                    <p className={`font-medium ${step.done ? '' : 'text-muted-foreground'}`}>
                      {step.label}
                    </p>
                    {step.at ? (
                      <p className="text-sm text-muted-foreground">{formatDate(step.at)}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Escrow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {transaction.escrow ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">Held amount</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCents(transaction.escrow.amountCents)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expires</p>
                  <p>{formatDate(transaction.escrow.expiresAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Released</p>
                  <p>{transaction.escrow.released ? 'Yes' : 'No'}</p>
                </div>
                <Separator />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No escrow record.</p>
            )}
            <ReleaseEscrowButton
              transactionId={transaction.id}
              status={transaction.status as TransactionStatus}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
