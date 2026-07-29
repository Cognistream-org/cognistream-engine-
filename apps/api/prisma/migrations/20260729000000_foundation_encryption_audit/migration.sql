-- Foundation: field-level encryption columns + immutable audit trail fields.

-- Agent PII/metadata (encrypted at application layer)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}';

-- Webhook secrets need room for AES-GCM envelope JSON
ALTER TABLE "webhooks" ALTER COLUMN "secret" SET DATA TYPE TEXT;

-- Existing audit rows (if any) get genesis placeholders before NOT NULL constraints
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "integrity_hash" VARCHAR(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "previous_hash" VARCHAR(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_type" VARCHAR(32);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "changes" JSONB DEFAULT '{}';
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "result" VARCHAR(32);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" VARCHAR(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" VARCHAR(512);

UPDATE "audit_logs"
SET
  "integrity_hash" = COALESCE("integrity_hash", 'legacy-unhashed'),
  "actor_type" = COALESCE("actor_type", 'system'),
  "result" = COALESCE("result", 'success')
WHERE "integrity_hash" IS NULL OR "actor_type" IS NULL OR "result" IS NULL;

ALTER TABLE "audit_logs" ALTER COLUMN "integrity_hash" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "actor_type" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "result" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
