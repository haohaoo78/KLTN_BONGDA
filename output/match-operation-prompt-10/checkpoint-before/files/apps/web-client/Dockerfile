FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web-client/package.json apps/web-client/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/web-client/node_modules ./apps/web-client/node_modules
COPY . .
ENV VITE_API_BASE=/api
RUN pnpm --filter @sfl/shared build && pnpm --filter @sfl/web-client build

FROM nginx:1.27-alpine
COPY apps/web-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-client/dist /usr/share/nginx/html
EXPOSE 80
