'use client';

import useSWR from 'swr';
import { toast } from 'sonner';
import type { AgentResponse } from '@cognistream/shared';
import {
  activateAgent,
  deactivateAgent,
  fetchAgents,
  proxyUrl,
} from '@/lib/api';
import { formatDate } from '@/lib/format';
import { AgentStatusBadge, reputationToPercent } from '@/components/dashboard/agent-status-badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function AgentsTable() {
  const { data, isLoading, mutate } = useSWR(proxyUrl('v1/agents'), () =>
    fetchAgents({ limit: '50' }),
  );

  async function toggleStatus(agent: AgentResponse) {
    try {
      if (agent.status === 'active') {
        await deactivateAgent(agent.id);
        toast.success(`${agent.name} deactivated`);
      } else {
        await activateAgent(agent.id);
        toast.success(`${agent.name} activated`);
      }
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const agents = data?.data ?? [];

  if (agents.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        No agents yet. Create agents via the API to get started.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reputation</TableHead>
          <TableHead>Capabilities</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.id}>
            <TableCell className="font-medium">{agent.name}</TableCell>
            <TableCell>
              <AgentStatusBadge status={agent.status} />
            </TableCell>
            <TableCell className="min-w-[140px]">
              <div className="flex items-center gap-2">
                <Progress value={reputationToPercent(agent.reputationScore)} className="h-2" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {agent.reputationScore}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                    >
                      {cap}
                    </span>
                  ))
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(agent.createdAt)}</TableCell>
            <TableCell className="text-right">
              {agent.status !== 'suspended' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void toggleStatus(agent)}
                >
                  {agent.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
