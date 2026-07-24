import type { AgentStatus } from '@cognistream/shared';
import { Badge } from '@/components/ui/badge';

const statusVariant: Record<
  AgentStatus,
  'success' | 'muted' | 'destructive'
> = {
  active: 'success',
  inactive: 'muted',
  suspended: 'destructive',
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Badge variant={statusVariant[status]} className="capitalize">
      {status}
    </Badge>
  );
}

export function reputationToPercent(score: string): number {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
