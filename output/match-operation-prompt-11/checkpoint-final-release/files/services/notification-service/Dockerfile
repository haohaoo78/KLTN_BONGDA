FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/notification-service/package.json services/notification-service/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/services/notification-service/node_modules ./services/notification-service/node_modules
COPY . .
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/notification-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/notification-service/dist ./services/notification-service/dist
COPY --from=build /app/services/notification-service/package.json ./services/notification-service/package.json
COPY --from=build /app/services/notification-service/node_modules ./services/notification-service/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3006
CMD ["node", "services/notification-service/dist/index.js"]
