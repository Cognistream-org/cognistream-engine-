-- Align api_keys.scopes default with Prisma schema (adds read:transactions).
ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET DEFAULT ARRAY['read:agents', 'read:transactions', 'write:transactions']::TEXT[];
