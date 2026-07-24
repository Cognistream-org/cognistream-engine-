'use client';

import { CodePreview } from './code-preview';
import { FeaturesGrid } from './features-grid';
import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { LandingFooter } from './footer';
import { LandingHeader } from './landing-header';
import { PricingTeaser } from './pricing-teaser';
import { SocialProof } from './social-proof';

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <LandingHeader />
      <Hero />
      <SocialProof />
      <HowItWorks />
      <CodePreview />
      <FeaturesGrid />
      <PricingTeaser />
      <LandingFooter />
    </div>
  );
}
