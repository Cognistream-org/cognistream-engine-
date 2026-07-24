# Changelog

## [0.1.0] — 2026-07-24

### Added
- Monorepo foundation: `apps/api`, `apps/web`, `packages/shared`
- Docker Compose for PostgreSQL 16 + Redis 7
- Prisma models: Organization, Agent, ApiKey, Transaction, ReputationEvent
- API key auth (`X-API-Key`) with Redis cache + bcrypt hashes
- Multi-window rate limiting (org / agent / endpoint) with fail-closed behavior
- Agents API: create, list, get, activate, deactivate
- API keys API: create (plaintext once), list (paginated), revoke
- Standardized error envelope `{ error: { code, message, requestId } }`
- Vitest coverage gate (≥80%) and Fortune-500 verification checklist

### Security
- Revoked API keys invalidate Redis auth cache via `apikey:id:{id}` mapping
- Auth cache TTL reduced to 5 seconds
- Validation failures return HTTP 422
