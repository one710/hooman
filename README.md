<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**Your virtual workforce, one concierge.** 🧑‍💼

Personas organize MCP connections and skills; you talk only to **Hooman**. Hooman is the concierge: they remember context, decide when to handle something themselves or hand off to a persona when a task fits, and keep you in control with approvals and a full audit trail.

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

> ⚠️ **Experimental / work in progress.** This project is not production-ready. Use with caution and only in a properly sandboxed environment.

---

## Why Hooman? ✨

You don't manage a dozen bots. You have **one conversation** with Hooman. Want a report drafted? A meeting summarized? Research done? You say it. Hooman either does it or hands off to a persona that can (fetch, filesystem, custom MCP servers, installed skills). You get one place to chat, schedule tasks, and see what happened—without talking to individual agents.

- **🚪 One front door** — Chat, schedule, and inspect everything through Hooman.
- **🦸 Personas with superpowers** — Give each persona a role (e.g. researcher, writer) and attach MCP connections and skills. Hooman hands off when a task fits.
- **🎛️ Under your control** — Kill switch, capability approvals, and an audit log so you see who did what and when.

---

## How it works ⚙️

| Concept             | What it is                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🤖 Hooman**       | The main agent. Reasons over memory, handles your messages and scheduled tasks, and hands off to personas when needed.                                  |
| **👥 Personas**     | Role-based handoff targets you define (id, description, responsibilities). Each has specific MCP connections and skills. Hooman delegates work to them. |
| **🔌 Capabilities** | MCP servers (fetch, time, filesystem, or your own) and skills. You assign which personas get which capabilities.                                        |
| **🧠 Memory**       | mem0: in-memory vector store + SQLite history (memory.db) so Hooman can use past context.                                                               |

You chat with Hooman; Hooman uses memory, may hand off to a persona, and responds. Scheduled tasks run the same way—at a set time, Hooman processes the task like a message (reasoning, handoff, audit).

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

Clone the repo, install dependencies, build, and run with PM2:

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
yarn install
yarn build
npx pm2 start ecosystem.config.cjs
```

- **API** → http://localhost:3000
- **Web UI** → http://localhost:5173

Set your OpenAI API key and models in **Settings**, then chat with Hooman and add Personas in the UI.

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

## Environment 📋

When running locally, create a `.env` from `.env.example`. Key variables:

| Variable                | Required | Description                                                                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | No       | Prisma SQLite URL (default: `workspace/hooman.db` at project root).                                                     |
| `PORT`                  | No       | API port (default 3000).                                                                                                |
| `VITE_API_BASE`         | No       | Set when building for production so the web app can call the API (e.g. `http://localhost:3000`).                        |
| `MCP_STDIO_DEFAULT_CWD` | No       | Working directory for stdio MCP / filesystem server (default: `workspace/mcpcwd`).                                      |
| `SKILLS_CWD`            | No       | Override project root for skills (default: repo root). Skills are installed and listed from `<project>/.agents/skills`. |

All runtime data is stored under **`workspace/`** at project root: `hooman.db` (Prisma), `config.json` (Settings), `memory.db` (mem0 history), `vector.db` (mem0 vector store – created on first chat after you set an API key), and `attachments/`. Stdio MCP servers use `workspace/mcpcwd` by default. OpenAI API key, models, and web search are set in the **Settings** UI (persisted by the API), not via env.

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
