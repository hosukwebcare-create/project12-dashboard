# syntax=docker/dockerfile:1.7
# 별하 운영 이미지. next.config.ts 의 output: "standalone" 을 전제로 한다.
#   docker build -t byeolha .
#   docker run -p 3000:3000 --env-file .env.production byeolha

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app

# ---- 의존성 ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- 빌드 ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- 마이그레이션 실행용 (docker compose 의 migrate 서비스, Cloud Run Job) ----
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/db ./src/db
COPY src/lib ./src/lib
CMD ["pnpm", "exec", "drizzle-kit", "migrate"]

# ---- 실행 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# 로컬 저장소 드라이버용 (GCS 를 쓰면 비어 있어도 된다)
RUN mkdir -p /app/storage && chown app:app /app/storage
USER app
EXPOSE 3000
CMD ["node", "server.js"]
