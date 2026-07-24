#!/bin/sh
set -e

export PATH="/app/node_modules/.bin:/app/apps_api_node_modules/.bin:$PATH"

echo "[demo] Running migrations..."
if command -v prisma >/dev/null 2>&1; then
  prisma migrate deploy --schema=./prisma/schema.prisma
elif [ -f ./node_modules/prisma/build/index.js ]; then
  node ./node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
else
  node ./apps_api_node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
fi

echo "[demo] Seeding demo data (3 orgs, 10 agents, 20 txs, 2 disputes)..."
if command -v tsx >/dev/null 2>&1; then
  tsx prisma/seed-demo.ts
else
  node --experimental-strip-types prisma/seed-demo.ts
fi

echo "[demo] Starting API on :3001"
exec node dist/index.js
