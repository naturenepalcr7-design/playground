# ============================================================
# Frontend Dockerfile — Next.js 14 + OpenLayers
# Multi-stage build powered by Bun
# ============================================================

# ---- Dependencies Stage ----
FROM oven/bun:1-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json bun.lockb* bun.lock* package-lock.json* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# ---- Build Stage ----
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_TILE_URL=/tiles

RUN bun run build

# ---- Production Stage ----
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

USER bun
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static

CMD ["bun", "server.js"]
