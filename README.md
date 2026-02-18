<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**One identity. Every channel.**

Hooman is your virtual identity: one conversation that follows you. Talk from the web, Slack, or WhatsApp. Hooman remembers context, uses MCP and skills to get things done, and keeps you in control with an audit trail and approvals.

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

> **Experimental / work in progress.** This project is not production-ready. Use with caution and only in a properly sandboxed environment.

---

## Why Hooman

You don’t juggle a dozen bots. You have **one conversation** with Hooman. Need a report drafted, a meeting summarized, or research done? Say it. Hooman uses MCP connections and skills directly. You get one place to chat, schedule tasks, and see what happened.

- **One front door** — Chat, schedule, and inspect everything through Hooman.
- **MCP and skills** — Capabilities (MCP servers and skills) are attached to Hooman. Add connections and skills in the UI; Hooman uses them when relevant.
- **Multiple LLM providers** — In Settings, choose an LLM provider (OpenAI, Azure OpenAI, Anthropic, Amazon Bedrock, Google Generative AI, Google Vertex, Mistral, or DeepSeek) for chat and memory. Choose a transcription provider (OpenAI, Azure, or Deepgram) for voice and audio (e.g. WhatsApp voice notes). Memory embeddings are generated locally (embeddings.js); no extra API.
- **Under your control** — Kill switch, capability approvals, and a full audit log so you see who did what and when.

---

## First-party channels

Talk to Hooman from the channels you already use. Each channel is a first-party adapter; configure them in **Settings → Channels**.

| Channel      | What you get                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Web**      | Built-in chat UI at the heart of the app. Your main control panel for chatting, scheduling, capabilities, and audit.                             |
| **Slack**    | First-party adapter (Socket Mode). DMs, channels, and groups where the app is installed. Optional Slack MCP (Go) adds history, search, and post. |
| **WhatsApp** | First-party adapter (whatsapp-web.js). Text and voice notes; voice is transcribed with your chosen transcription provider.                       |

One identity, one memory, one audit trail—whether you message from the web, Slack, or WhatsApp.

---

## How it works

| Concept          | What it is                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Hooman**       | A virtual identity. Reasons over memory, handles messages and scheduled tasks, and uses MCP tools and skills as needed.    |
| **Capabilities** | MCP servers (fetch, time, filesystem, or your own) and skills. Attached to Hooman; configure in Capabilities and Settings. |
| **Memory**       | mem0: in-memory vector store and SQLite history (`memory.db`) so Hooman can use past context.                              |

You chat with Hooman; Hooman uses memory, MCP tools, and skills, and responds. Scheduled tasks run the same way—at a set time, Hooman processes the task like a message (reasoning, tools, audit).

---

## Prerequisites

- **Node.js** — [Latest LTS](https://nodejs.org/) (v20 or v22). Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to switch versions.
- **Yarn** — `corepack enable` then `corepack prepare yarn@stable --activate`, or install from [yarnpkg.com](https://yarnpkg.com/).
- **uv + Python** — Required for default MCP servers (fetch, time, filesystem). Install [uv](https://docs.astral.sh/uv/) then:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  uv python install --default
  ```
  Ensure `uv` and `python` are on your `PATH`.
- **Go** — Optional. Only needed if you use the **Slack** channel and want the default Slack MCP (history, search, post). Install [Go](https://go.dev/doc/install) then:
  ```bash
  go install github.com/korotovsky/slack-mcp-server@latest
  ```
  Ensure the Go bin directory (e.g. `$HOME/go/bin`) is on your `PATH` so `slack-mcp-server` is available.

No separate database server: the app uses Prisma + SQLite and mem0 (in-memory + SQLite history).

---

## Quick start

Clone the repo, install dependencies, build, start Redis (required for the event queue), and run with PM2:

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
yarn install
yarn build
docker compose up -d redis
yarn start
```

- **API** → http://localhost:3000
- **Web UI** → http://localhost:5173

Set your **LLM provider** and API key (or credentials) in **Settings**, then chat with Hooman. Configure MCP connections and skills in **Capabilities**. Supported providers: OpenAI, Azure, Anthropic, Amazon Bedrock, Google, Google Vertex, Mistral, DeepSeek.

To stop: `yarn stop` (or `npx pm2 stop ecosystem.config.cjs`).

---

## Development

For active development with live reload, run the full stack (API, frontend, Slack worker, WhatsApp worker, cron, event-queue):

```bash
yarn install
yarn dev
```

For API and web UI only, run in two terminals:

```bash
yarn dev:api    # API on port 3000
yarn dev:frontend   # UI on port 5173
```

Create a `.env` from `.env.example` if you need to override defaults (e.g. `MCP_STDIO_DEFAULT_CWD`, `REDIS_URL`).

---

## Exposing completions (optional)

Ngrok is **not** required for normal use. Use it only when you want to expose the OpenAI-compatible chat completions API to external apps (e.g. ElevenLabs). Only `/v1/chat/completions` and `/chat/completions` are reachable over the tunnel; all other endpoints return 403 when the request comes from the public URL.

1. **Run the API** (e.g. `yarn dev:api` or `yarn start`) so it listens on port 3000.

2. **Configure ngrok.** Copy the example config and add your auth token:

   ```bash
   cp ngrok.example.yml ngrok.yml
   ```

   In `.env`, set `NGROK_AUTHTOKEN` (from the [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)). In `ngrok.yml`, set a reserved `domain` if you have one, or remove the `domain` line to use a random ngrok URL.

3. **Start the ngrok tunnel** (uses the `remote` profile):

   ```bash
   docker compose --profile remote up -d ngrok
   ```

   The tunnel forwards to `host.docker.internal:3000`. The ngrok UI is at http://localhost:4040.

4. **Use the endpoint.** In Hooman **Settings**, set **Completions API key** (Bearer token for the completions API). Then:
   ```bash
   curl -X POST https://<your-ngrok-domain>/v1/chat/completions \
     -H "Authorization: Bearer YOUR_COMPLETIONS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"Hello"}]}'
   ```
   Replace `<your-ngrok-domain>` with your ngrok host and `YOUR_COMPLETIONS_API_KEY` with the value from Settings.

Access at http://localhost:3000 and the UI at :5173 is unchanged; only requests via the ngrok host are restricted to the two completions paths.

---

## Environment

When running locally, create a `.env` from `.env.example`. Key variables:

| Variable                | Required | Description                                                                                                     |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | No       | Prisma SQLite URL (default: `workspace/hooman.db` at project root).                                             |
| `PORT`                  | No       | API port (default 3000).                                                                                        |
| `REDIS_URL`             | Yes\*    | Redis for event queue and kill switch (e.g. `redis://localhost:6379`). Start with `docker compose up -d redis`. |
| `VITE_API_BASE`         | No       | Set when building for production so the web app can call the API (e.g. `http://localhost:3000`).                |
| `MCP_STDIO_DEFAULT_CWD` | No       | Working directory for stdio MCP / filesystem server (default: `workspace/mcpcwd`).                              |
| `SKILLS_CWD`            | No       | Override project root for skills (default: repo root). Skills are in `<project>/.agents/skills`.                |

All runtime data is stored under **`workspace/`** at project root: `hooman.db` (Prisma), `config.json` (Settings), `memory.db` (mem0 history), `vector.db` (mem0 vectors, created on first chat after you set an API key), and `attachments/`. Stdio MCP servers use `workspace/mcpcwd` by default. LLM provider, transcription provider, API keys or credentials, models, and web search are set in the **Settings** UI (persisted by the API), not via env.

---

## Scripts

| Command             | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `yarn dev`          | Full stack: API, frontend, Slack worker, WhatsApp worker, cron, event-queue (ports 3000, 5173). |
| `yarn dev:api`      | API only (port 3000).                                                                           |
| `yarn dev:frontend` | Web UI only (port 5173).                                                                        |
| `yarn dev:slack`    | Slack worker only.                                                                              |
| `yarn dev:whatsapp` | WhatsApp worker only.                                                                           |
| `yarn build`        | Build API and web app.                                                                          |
| `yarn start`        | Start API and web with PM2 (production).                                                        |
| `yarn stop`         | Stop PM2 processes.                                                                             |
| `yarn restart`      | Restart PM2 processes.                                                                          |

After code or config changes in production, run `yarn build` then `yarn restart`.

---

## License

[GNU General Public License v3.0](LICENSE).
