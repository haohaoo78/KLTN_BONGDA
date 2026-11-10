FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/auth-service/package.json services/auth-service/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/services/auth-service/node_modules ./services/auth-service/node_modules
COPY . .
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/auth-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/auth-service/dist ./services/auth-service/dist
COPY --from=build /app/services/auth-service/package.json ./services/auth-service/package.json
COPY --from=build /app/services/auth-service/node_modules ./services/auth-service/node_modules
COPY --from=build /app/services/auth-service/src/db/schema.sql ./services/auth-service/dist/db/schema.sql
COPY --from=build /app/services/auth-service/src/db/account-schema.sql ./services/auth-service/dist/db/account-schema.sql
COPY --from=build /app/services/auth-service/src/db/account-migration-v2.sql ./services/auth-service/dist/db/account-migration-v2.sql
COPY --from=build /app/services/auth-service/src/db/account-migration-v3.sql ./services/auth-service/dist/db/account-migration-v3.sql
COPY --from=build /app/services/auth-service/src/db/account-migration-v4.sql ./services/auth-service/dist/db/account-migration-v4.sql
COPY --from=build /app/services/auth-service/src/db/account-migration-v5.sql ./services/auth-service/dist/db/account-migration-v5.sql
COPY --from=build /app/services/auth-service/src/db/account-migration-v6.sql ./services/auth-service/dist/db/account-migration-v6.sql
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "services/auth-service/dist/index.js"]
