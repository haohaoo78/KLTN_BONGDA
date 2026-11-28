FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api-gateway/package.json apps/api-gateway/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY . .
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/api-gateway build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api-gateway/dist ./apps/api-gateway/dist
COPY --from=build /app/apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY --from=build /app/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "apps/api-gateway/dist/index.js"]
