# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `npm ci` 会触发项目的 `postinstall`（执行 `prisma generate`），需要先提供 schema/config。
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./
RUN mkdir -p src/generated
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -- --webpack
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
