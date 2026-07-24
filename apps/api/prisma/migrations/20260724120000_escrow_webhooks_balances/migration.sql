-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'failed';

-- AlterTable agents: spendable wallet
ALTER TABLE "agents" ADD COLUMN "balance_cents" BIGINT NOT NULL DEFAULT 0;

-- AlterTable transactions: idempotency
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_idempotency_key_idx" ON "transactions"("idempotency_key");

-- CreateTable
CREATE TABLE "escrow" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "escrow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "escrow_transaction_id_key" ON "escrow"("transaction_id");

-- AddForeignKey
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "secret" VARCHAR(128) NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhooks_org_id_active_idx" ON "webhooks"("org_id", "active");

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
