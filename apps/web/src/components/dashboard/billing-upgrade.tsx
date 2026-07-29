'use client';

import { useState } from 'react';
import { createCheckoutSession } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const TIERS = [
  {
    id: 'developer' as const,
    name: 'Developer',
    monthlyPriceCents: 4_900,
    description: 'For shipping agent payment flows in production.',
    features: ['10k API calls', '1k transactions', 'Stripe Connect', 'Priority support'],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    monthlyPriceCents: 29_900,
    description: 'Higher limits and dedicated support for scaled orgs.',
    features: ['100k API calls', '10k transactions', 'SLA', 'Dedicated support'],
  },
];

export function BillingUpgrade() {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(tier: 'developer' | 'enterprise') {
    setError(null);
    setLoadingTier(tier);
    try {
      const origin = window.location.origin;
      const session = await createCheckoutSession({
        tier,
        cycle: 'monthly',
        successUrl: `${origin}/dashboard/billing?checkout=success`,
        cancelUrl: `${origin}/dashboard/billing/upgrade?checkout=cancel`,
      });
      window.location.href = session.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoadingTier(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upgrade plan</h1>
        <p className="text-muted-foreground">
          Choose a paid tier. Checkout is handled securely by Stripe.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {TIERS.map((tier) => (
          <Card key={tier.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{tier.name}</CardTitle>
                <Badge variant="outline">{formatCents(tier.monthlyPriceCents)}/mo</Badge>
              </div>
              <CardDescription>{tier.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm text-muted-foreground">
                {tier.features.map((feature) => (
                  <li key={feature}>· {feature}</li>
                ))}
              </ul>
              <Button
                className="w-full"
                disabled={loadingTier !== null}
                onClick={() => startCheckout(tier.id)}
              >
                {loadingTier === tier.id ? 'Redirecting…' : `Upgrade to ${tier.name}`}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
