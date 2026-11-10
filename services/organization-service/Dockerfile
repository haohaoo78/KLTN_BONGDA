FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/organization-service/package.json services/organization-service/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/services/organization-service/node_modules ./services/organization-service/node_modules
COPY . .
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/organization-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/organization-service/dist ./services/organization-service/dist
COPY --from=build /app/services/organization-service/src/db/institution-catalog.json ./services/organization-service/dist/db/institution-catalog.json
COPY --from=build /app/services/organization-service/package.json ./services/organization-service/package.json
COPY --from=build /app/services/organization-service/node_modules ./services/organization-service/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3004
CMD ["node", "services/organization-service/dist/index.js"]
