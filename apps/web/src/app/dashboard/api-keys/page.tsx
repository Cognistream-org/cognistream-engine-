import { ApiKeysPanel } from '@/components/dashboard/api-keys-panel';

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
        <p className="text-muted-foreground">Create and revoke keys for API access.</p>
      </div>
      <ApiKeysPanel />
    </div>
  );
}
