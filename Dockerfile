# ── build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── production stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# better-sqlite3 is a native addon; keep only production deps so we don't
# ship devDependencies, then prune the npm cache.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./server/
COPY --from=build /app/dist ./dist

# Data directory is expected to be a mounted volume.
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server/index.js"]
