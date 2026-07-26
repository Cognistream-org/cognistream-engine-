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
  // Canonical reputation is 0–1; Progress expects 0–100. Values > 1 are treated as already percent.
  const pct = n <= 1 ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(pct)));
}
