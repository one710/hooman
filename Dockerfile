# Dev image: deps only, no build. Used by api-dev and web-dev (different commands).
FROM node:20-alpine AS dev
WORKDIR /app
COPY package.json yarn.lock* ./
COPY tsconfig.base.json ./
COPY apps/api apps/api/
COPY apps/web apps/web/
RUN corepack enable && yarn install --frozen-lockfile 2>/dev/null || yarn install
RUN mkdir -p /app/mcp-cwd
ENV MCP_STDIO_DEFAULT_CWD=/app/mcp-cwd

# Build for production
FROM dev AS builder
RUN yarn build:api && yarn build:web

# Production API (profile: prod)
FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock* ./
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/apps/api/dist apps/api/dist/
RUN mkdir -p /app/mcp-cwd
ENV MCP_STDIO_DEFAULT_CWD=/app/mcp-cwd
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]

# Production web (profile: prod): nginx serving built static + proxy to api
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
