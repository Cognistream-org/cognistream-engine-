FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/
RUN pnpm install --frozen-lockfile --filter @cognistream/docs...

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules
COPY . .
ENV NEXT_STANDALONE=1
RUN pnpm --filter @cognistream/docs build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
RUN addgroup -S cognistream && adduser -S cognistream -G cognistream
COPY --from=build /app/apps/docs/public ./apps/docs/public
COPY --from=build /app/apps/docs/.next/standalone ./
COPY --from=build /app/apps/docs/.next/static ./apps/docs/.next/static
USER cognistream
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/ || exit 1
CMD ["node", "apps/docs/server.js"]
