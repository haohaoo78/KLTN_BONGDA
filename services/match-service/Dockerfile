FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/match-service/package.json services/match-service/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/services/match-service/node_modules ./services/match-service/node_modules
COPY . .
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/match-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/match-service/dist ./services/match-service/dist
COPY --from=build /app/services/match-service/package.json ./services/match-service/package.json
COPY --from=build /app/services/match-service/node_modules ./services/match-service/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3005
CMD ["node", "services/match-service/dist/index.js"]
