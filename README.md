<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**Your virtual identity.** 🧑‍💼

You talk only to **Hooman**. Hooman is a virtual identity: they remember context, can act and get things done as needed, use MCP connections and skills directly, and keep you in control with approvals and a full audit trail.

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

> ⚠️ **Experimental / work in progress.** This project is not production-ready. Use with caution and only in a properly sandboxed environment.

---

## Why Hooman? ✨

You don't manage a dozen bots. You have **one conversation** with Hooman. Want a report drafted? A meeting summarized? Research done? You say it. Hooman uses MCP connections (fetch, filesystem, custom servers) and installed skills directly. You get one place to chat, schedule tasks, and see what happened.

- **🚪 One front door** — Chat, schedule, and inspect everything through Hooman.
- **🔌 MCP and skills** — Capabilities (MCP servers and skills) are attached directly to Hooman. Add connections and skills in the UI; Hooman uses them when relevant.
- **🔀 Multiple LLM providers** — In Settings, choose an **LLM provider** (OpenAI, Azure OpenAI, Anthropic, Amazon Bedrock, Google Generative AI, Google Vertex, Mistral, or DeepSeek) for chat and Mem0. Choose a **Transcription provider** (OpenAI, Azure, or Deepgram) for voice/audio messages (e.g. WhatsApp voice notes). Memory embeddings are generated locally (no API) via embeddings.js.
- **🎛️ Under your control** — Kill switch, capability approvals, and an audit log so you see who did what and when.

---

## How it works ⚙️

| Concept             | What it is                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **🤖 Hooman**       | A virtual identity. Reasons over memory, handles messages and scheduled tasks, and uses MCP tools and skills directly as needed.           |
| **🔌 Capabilities** | MCP servers (fetch, time, filesystem, or your own) and skills. Attached directly to Hooman; configure in the Capabilities and Settings UI. |
| **🧠 Memory**       | mem0: in-memory vector store + SQLite history (memory.db) so Hooman can use past context.                                                  |

You chat with Hooman; Hooman uses memory, MCP tools, and skills, and responds. Scheduled tasks run the same way—at a set time, Hooman processes the task like a message (reasoning, tools, audit).

---

## Prerequisites

Install the following on your machine:

- **Node.js** — [Latest LTS](https://nodejs.org/) (v20 or v22). Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) if you need to switch versions.
- **Yarn** — `corepack enable` then `corepack prepare yarn@stable --activate`, or install from [yarnpkg.com](https://yarnpkg.com/).
- **uv + Python** — Required for default MCP servers (fetch, time, filesystem). Install [uv](https://docs.astral.sh/uv/) then Python:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  uv python install --default
  ```
  Ensure `uv` and `python` are on your `PATH`.
- **Go** — Optional; required only if you use the **Slack** channel and want the default Slack MCP (history, search, post). Install [Go](https://go.dev/doc/install) then:
  ```bash
  go install github.com/korotovsky/slack-mcp-server@latest
  ```
  Ensure the Go bin directory (e.g. `$HOME/go/bin`) is on your `PATH` so `slack-mcp-server` is available.

No separate database server: the app uses Prisma + SQLite and mem0 (in-memory + SQLite history).

---

## Quick start 🚀

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

To stop: `npx pm2 stop ecosystem.config.cjs` (or `yarn stop`).

---

## Development 🛠️

For active development with live reload, run API and web together:

```bash
yarn install
yarn dev:all   # API :3000, UI :5173
```

Create a `.env` from `.env.example` if you need to override defaults (e.g. `MCP_STDIO_DEFAULT_CWD`).

---

## Exposing completions 🌐 (optional)

Ngrok is **not** required for normal use. Use it only when you want to test the OpenAI-compatible chat completions API from external apps (e.g. ElevenLabs). Only `/v1/chat/completions` and `/chat/completions` are reachable over the tunnel; all other endpoints return 403 when the request comes from the public URL.

1. **Run the API on the host** (e.g. `yarn dev:api` or `yarn start`) so it listens on port 3000.

2. **Configure ngrok.** Copy the example config and add your auth token:

   ```bash
   cp ngrok.example.yml ngrok.yml
   ```

   In `.env`, set `NGROK_AUTHTOKEN` (get it from [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)). In `ngrok.yml`, set a reserved `domain` if you have one, or remove the `domain` line to use a random ngrok URL.

3. **Start the ngrok tunnel** (uses the `remote` profile so it doesn’t run with a plain `docker compose up`):

   ```bash
   docker compose --profile remote up -d ngrok
   ```

   The tunnel forwards to `host.docker.internal:3000`. The ngrok UI is at http://localhost:4040.

4. **Use the endpoint.** In Hooman **Settings**, set **Completions API key** (this is the Bearer token for the completions API). Then call:
   ```bash
   curl -X POST https://<your-ngrok-domain>/v1/chat/completions \
     -H "Authorization: Bearer YOUR_COMPLETIONS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"Hello"}]}'
   ```
   Replace `<your-ngrok-domain>` with your ngrok host (e.g. `powerful-tiger-notable.ngrok-free.app`) and `YOUR_COMPLETIONS_API_KEY` with the value from Settings.

Access to the app at http://localhost:3000 (and the UI at :5173) is unchanged; only requests that arrive via the ngrok host (or another non-local client) are restricted to the two completions paths.

---

## Environment 📋

When running locally, create a `.env` from `.env.example`. Key variables:

| Variable                | Required | Description                                                                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | No       | Prisma SQLite URL (default: `workspace/hooman.db` at project root).                                                     |
| `PORT`                  | No       | API port (default 3000).                                                                                                |
| `VITE_API_BASE`         | No       | Set when building for production so the web app can call the API (e.g. `http://localhost:3000`).                        |
| `MCP_STDIO_DEFAULT_CWD` | No       | Working directory for stdio MCP / filesystem server (default: `workspace/mcpcwd`).                                      |
| `SKILLS_CWD`            | No       | Override project root for skills (default: repo root). Skills are installed and listed from `<project>/.agents/skills`. |

All runtime data is stored under **`workspace/`** at project root: `hooman.db` (Prisma), `config.json` (Settings), `memory.db` (mem0 history), `vector.db` (mem0 vector store – created on first chat after you set an API key), and `attachments/`. Stdio MCP servers use `workspace/mcpcwd` by default. **LLM provider** (OpenAI, Azure, Anthropic, Bedrock, Google, Google Vertex, Mistral, DeepSeek), **Transcription provider** (OpenAI, Azure, or Deepgram for voice/audio), API keys or credentials, models, and web search are set in the **Settings** UI (persisted by the API), not via env. Memory embeddings are generated locally (embeddings.js); voice/audio uses the chosen transcription provider.

---

## Scripts 📜

| Command        | Description                              |
| -------------- | ---------------------------------------- |
| `yarn dev`     | Start API (port 3000).                   |
| `yarn dev:web` | Start UI dev server (port 5173).         |
| `yarn dev:all` | Start API and UI together.               |
| `yarn build`   | Build API and web app.                   |
| `yarn start`   | Start API and web with PM2 (production). |
| `yarn stop`    | Stop PM2 processes.                      |
| `yarn restart` | Restart PM2 processes.                   |

After code or config changes in production, run `yarn build` then `yarn restart`.

---

## License 📄

[GNU General Public License v3.0](LICENSE).
