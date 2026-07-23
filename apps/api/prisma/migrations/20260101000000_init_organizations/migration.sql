-- CreateEnum
CREATE TYPE "OrganizationTier" AS ENUM ('free', 'developer', 'enterprise');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "tier" "OrganizationTier" NOT NULL DEFAULT 'free',
    "balance_cents" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
