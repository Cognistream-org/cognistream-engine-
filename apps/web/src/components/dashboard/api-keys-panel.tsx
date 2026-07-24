'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import type { ApiKeyMetadata, CreatedApiKey } from '@cognistream/shared';
import {
  createApiKey,
  fetchApiKeys,
  proxyUrl,
  revokeApiKey,
} from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export function ApiKeysPanel() {
  const { data, isLoading, mutate } = useSWR(proxyUrl('v1/api-keys'), () => fetchApiKeys());
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [plaintextOpen, setPlaintextOpen] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setCreating(true);
    try {
      const key = await createApiKey({ name: name.trim() });
      setCreatedKey(key);
      setPlaintextOpen(true);
      setCreateOpen(false);
      setName('');
      await mutate();
      toast.success('API key created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyMetadata) {
    if (!confirm(`Revoke "${key.name}"? This cannot be undone.`)) return;
    try {
      await revokeApiKey(key.id);
      await mutate();
      toast.success('API key revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  const keys = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage keys for programmatic access to CogniStream.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Create key</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Give your key a descriptive name. The secret is shown once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="keyName">Name</Label>
              <Input
                id="keyName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production dashboard"
              />
            </div>
            <DialogFooter>
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={plaintextOpen} onOpenChange={setPlaintextOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>
              Copy this key now. You won&apos;t be able to see it again.
            </DialogDescription>
          </DialogHeader>
          {createdKey ? (
            <div className="rounded-md border bg-muted p-3 font-mono text-sm break-all">
              {createdKey.key}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => {
                if (createdKey?.key) {
                  void navigator.clipboard.writeText(createdKey.key);
                  toast.success('Copied to clipboard');
                }
              }}
            >
              Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : keys.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">No API keys yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="font-mono text-xs">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                </TableCell>
                <TableCell>
                  {key.revokedAt ? (
                    <Badge variant="destructive">Revoked</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!key.revokedAt ? (
                    <Button variant="outline" size="sm" onClick={() => void handleRevoke(key)}>
                      Revoke
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
