/** PM2 ecosystem: backend (API), frontend, and workers (slack, whatsapp, cron, event-queue). Cron runs scheduled tasks only. Run `yarn build` first. CWD is project root. */
module.exports = {
  apps: [
    {
      name: "api",
      cwd: ".",
      interpreter: "node_modules/.bin/tsx",
      script: "apps/backend/src/index.ts",
      env: { NODE_ENV: "production" },
    },
    {
      name: "web",
      cwd: ".",
      script: "npx",
      args: "serve apps/frontend/dist -l 5173",
      env: { NODE_ENV: "production" },
    },
    {
      name: "slack",
      cwd: ".",
      interpreter: "node_modules/.bin/tsx",
      script: "apps/backend/src/workers/slack.ts",
      env: { NODE_ENV: "production" },
    },
    {
      name: "whatsapp",
      cwd: ".",
      interpreter: "node_modules/.bin/tsx",
      script: "apps/backend/src/workers/whatsapp.ts",
      env: { NODE_ENV: "production" },
    },
    {
      name: "cron",
      cwd: ".",
      interpreter: "node_modules/.bin/tsx",
      script: "apps/backend/src/workers/cron.ts",
      env: { NODE_ENV: "production" },
    },
    {
      name: "event-queue",
      cwd: ".",
      interpreter: "node_modules/.bin/tsx",
      script: "apps/backend/src/workers/event-queue.ts",
      env: { NODE_ENV: "production" },
    },
  ],
};
