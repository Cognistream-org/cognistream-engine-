'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  createConnectOnboarding,
  createStripeConnect,
  disconnectStripeConnect,
  fetchStripeConnect,
  proxyUrl,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function BillingConnect() {
  const { data, error, isLoading, mutate } = useSWR(
    proxyUrl('v1/stripe/connect'),
    () => fetchStripeConnect(),
    {
      shouldRetryOnError: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const missing = error instanceof Error && /not found/i.test(error.message);

  async function createAccount() {
    setBusy(true);
    setActionError(null);
    try {
      await createStripeConnect({ country: 'us' });
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create Connect account');
    } finally {
      setBusy(false);
    }
  }

  async function startOnboarding() {
    setBusy(true);
    setActionError(null);
    try {
      const origin = window.location.origin;
      const { url } = await createConnectOnboarding({
        returnUrl: `${origin}/dashboard/billing/connect?onboarding=return`,
        refreshUrl: `${origin}/dashboard/billing/connect?onboarding=refresh`,
      });
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start onboarding');
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      await disconnectStripeConnect();
      await mutate(undefined, { revalidate: false });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stripe Connect</h1>
        <p className="text-muted-foreground">
          Receive payouts from settled agent transactions.
        </p>
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Connect status</CardTitle>
          <CardDescription>Express account linked to this organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : missing || !data ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No Stripe Connect account yet. Create one to enable payouts.
              </p>
              <Button disabled={busy} onClick={createAccount}>
                {busy ? 'Creating…' : 'Create Connect account'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{data.status}</Badge>
                <Badge variant={data.chargesEnabled ? 'default' : 'outline'}>
                  Charges {data.chargesEnabled ? 'enabled' : 'disabled'}
                </Badge>
                <Badge variant={data.payoutsEnabled ? 'default' : 'outline'}>
                  Payouts {data.payoutsEnabled ? 'enabled' : 'disabled'}
                </Badge>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Account</dt>
                  <dd className="font-mono text-xs">{data.stripeAccountId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Country</dt>
                  <dd className="uppercase">{data.country}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {!data.chargesEnabled || !data.payoutsEnabled ? (
                  <Button disabled={busy} onClick={startOnboarding}>
                    {busy ? 'Opening…' : 'Continue onboarding'}
                  </Button>
                ) : null}
                <Button disabled={busy} variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
