'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { TransactionStatus } from '@cognistream/shared';
import { releaseEscrow } from '@/lib/api';
import { Button } from '@/components/ui/button';

export interface ReleaseEscrowButtonProps {
  transactionId: string;
  status: TransactionStatus;
}

export function ReleaseEscrowButton({ transactionId, status }: ReleaseEscrowButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const disabled = status !== 'escrowed' || pending;

  function handleRelease() {
    setError(null);
    startTransition(async () => {
      try {
        await releaseEscrow(transactionId);
        toast.success('Escrow released');
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Release failed';
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleRelease} disabled={disabled}>
        {pending ? 'Releasing…' : 'Release escrow'}
      </Button>
      {status !== 'escrowed' ? (
        <p className="text-xs text-muted-foreground">
          Only escrowed transactions can be released.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
