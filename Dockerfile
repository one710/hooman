# ─── Hooman Backend ────────────────────────────────────────────────
# Multi-stage build: install deps → generate Prisma client → slim runtime
#
# Default CMD runs the API server.  Override for workers:
#   docker run <image> npx tsx apps/backend/src/workers/event-queue.ts
#   docker run <image> npx tsx apps/backend/src/workers/slack.ts
#   docker run <image> npx tsx apps/backend/src/workers/whatsapp.ts
#   docker run <image> npx tsx apps/backend/src/workers/cron.ts
# ──────────────────────────────────────────────────────────────────────

# ── Stage 1: install ──────────────────────────────────────────────────
FROM node:24-slim AS deps

WORKDIR /app

# System libs required by argon2 (native addon) and Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .npmrc ./

RUN yarn install --frozen-lockfile --production=false

# ── Stage 2: prisma generate ─────────────────────────────────────────
FROM deps AS build

COPY apps/backend/prisma ./apps/backend/prisma
COPY tsconfig.base.json ./

RUN npx prisma generate --schema=apps/backend/prisma/schema.prisma

# ── Stage 3: runtime ─────────────────────────────────────────────────
# Full-featured image so stdio MCP servers (Python, Go, Node) can run.
FROM node:24 AS runtime

WORKDIR /app

# Build tools, Python 3, Go, Chromium (for whatsapp-web.js), and runtime essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential openssl ca-certificates git curl \
    python3 python3-pip python3-venv \
    golang \
    chromium \
    gnupg lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI (for docker-based stdio MCP servers)
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Use system Chromium — skip Puppeteer's bundled download
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy node_modules with native addons already built
COPY --from=build /app/node_modules ./node_modules

# Copy generated Prisma client
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma

# Copy source (backend, scripts, prompts, config files)
COPY package.json yarn.lock .npmrc tsconfig.base.json ecosystem.config.cjs ./
COPY apps/backend ./apps/backend
COPY scripts ./scripts

# Create workspace directory for SQLite DB and attachments
RUN mkdir -p /app/workspace/attachments /mcpcwd

# Persist data across container restarts
VOLUME ["/app/workspace", "/mcpcwd"]

ENV NODE_ENV=production
ENV PORT=3000
ENV MCP_STDIO_DEFAULT_CWD=/mcpcwd

EXPOSE 3000

# Start the API server
CMD ["npx", "tsx", "apps/backend/src/index.ts"]
