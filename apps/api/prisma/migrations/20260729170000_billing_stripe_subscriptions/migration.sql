-- Billing foundation: Stripe Connect, subscriptions, invoices, usage, platform fees.

-- Enums
CREATE TYPE "StripeConnectStatus" AS ENUM ('pending', 'onboarding', 'active', 'restricted', 'rejected');
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
CREATE TYPE "UsageMeterType" AS ENUM ('api_calls', 'transactions', 'transaction_volume_cents', 'agents', 'webhooks', 'disputes');

-- Stripe Connect accounts
CREATE TABLE "stripe_connect_accounts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "stripe_account_id" VARCHAR(255) NOT NULL,
    "status" "StripeConnectStatus" NOT NULL DEFAULT 'pending',
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_url" TEXT,
    "onboarding_url_expires_at" TIMESTAMPTZ(3),
    "default_currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "country" VARCHAR(2) NOT NULL DEFAULT 'us',
    "requirements_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stripe_connect_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_connect_accounts_org_id_key" ON "stripe_connect_accounts"("org_id");
CREATE UNIQUE INDEX "stripe_connect_accounts_stripe_account_id_key" ON "stripe_connect_accounts"("stripe_account_id");
CREATE INDEX "stripe_connect_accounts_stripe_account_id_idx" ON "stripe_connect_accounts"("stripe_account_id");
CREATE INDEX "stripe_connect_accounts_status_charges_enabled_idx" ON "stripe_connect_accounts"("status", "charges_enabled");

ALTER TABLE "stripe_connect_accounts"
  ADD CONSTRAINT "stripe_connect_accounts_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Subscriptions
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "stripe_subscription_id" VARCHAR(255),
    "stripe_customer_id" VARCHAR(255),
    "tier" "OrganizationTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_org_id_key" ON "subscriptions"("org_id");
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");
CREATE INDEX "subscriptions_org_id_status_idx" ON "subscriptions"("org_id", "status");
CREATE INDEX "subscriptions_stripe_subscription_id_idx" ON "subscriptions"("stripe_subscription_id");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoices
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subscription_id" UUID,
    "stripe_invoice_id" VARCHAR(255),
    "invoice_number" VARCHAR(32) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "amount_due_cents" BIGINT NOT NULL,
    "amount_paid_cents" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "pdf_url" TEXT,
    "hosted_url" TEXT,
    "due_date" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "line_items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_stripe_invoice_id_key" ON "invoices"("stripe_invoice_id");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "invoices_org_id_status_idx" ON "invoices"("org_id", "status");
CREATE INDEX "invoices_invoice_number_idx" ON "invoices"("invoice_number");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Usage records
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "meter_type" "UsageMeterType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" BIGINT,
    "billing_period" VARCHAR(7) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "source_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_records_org_id_billing_period_meter_type_idx" ON "usage_records"("org_id", "billing_period", "meter_type");
CREATE INDEX "usage_records_subscription_id_billing_period_idx" ON "usage_records"("subscription_id", "billing_period");

ALTER TABLE "usage_records"
  ADD CONSTRAINT "usage_records_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_records"
  ADD CONSTRAINT "usage_records_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Platform fee ledger
CREATE TABLE "platform_fee_ledger" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "gross_amount_cents" BIGINT NOT NULL,
    "platform_fee_cents" BIGINT NOT NULL,
    "net_amount_cents" BIGINT NOT NULL,
    "fee_basis_points" INTEGER NOT NULL,
    "stripe_transfer_id" VARCHAR(255),
    "transferred_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fee_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_fee_ledger_transaction_id_key" ON "platform_fee_ledger"("transaction_id");
CREATE INDEX "platform_fee_ledger_org_id_created_at_idx" ON "platform_fee_ledger"("org_id", "created_at");
CREATE INDEX "platform_fee_ledger_transaction_id_idx" ON "platform_fee_ledger"("transaction_id");

ALTER TABLE "platform_fee_ledger"
  ADD CONSTRAINT "platform_fee_ledger_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_fee_ledger"
  ADD CONSTRAINT "platform_fee_ledger_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: free/active subscription for every existing org
INSERT INTO "subscriptions" (
  "id",
  "org_id",
  "tier",
  "status",
  "current_period_start",
  "current_period_end",
  "cancel_at_period_end",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  o."id",
  'free'::"OrganizationTier",
  'active'::"SubscriptionStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '30 days',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "subscriptions" s WHERE s."org_id" = o."id"
);

-- Backfill: platform fee ledger for existing transactions (250 bps default)
INSERT INTO "platform_fee_ledger" (
  "id",
  "transaction_id",
  "org_id",
  "gross_amount_cents",
  "platform_fee_cents",
  "net_amount_cents",
  "fee_basis_points",
  "created_at"
)
SELECT
  gen_random_uuid(),
  t."id",
  a."org_id",
  t."amount_cents",
  t."fee_cents",
  t."amount_cents" - t."fee_cents",
  250,
  CURRENT_TIMESTAMP
FROM "transactions" t
JOIN "agents" a ON a."id" = t."buyer_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "platform_fee_ledger" p WHERE p."transaction_id" = t."id"
);
