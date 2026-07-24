import type { TransactionStatus } from '@cognistream/shared';
import { Badge } from '@/components/ui/badge';

const statusVariant: Record<
  TransactionStatus,
  'default' | 'warning' | 'success' | 'destructive' | 'muted' | 'secondary'
> = {
  pending: 'muted',
  escrowed: 'warning',
  settled: 'success',
  disputed: 'destructive',
  refunded: 'secondary',
  failed: 'destructive',
};

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <Badge variant={statusVariant[status]} className="capitalize">
      {status}
    </Badge>
  );
}
