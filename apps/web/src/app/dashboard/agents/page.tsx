import { AgentsTable } from '@/components/dashboard/agents-table';

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">Manage autonomous agents in your organization.</p>
      </div>
      <AgentsTable />
    </div>
  );
}
