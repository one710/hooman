<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**Your virtual workforce, one concierge.** 🧑‍💼

Build a team of AI colleagues—each with their own capabilities and skills—and talk only to **Hooman**. Hooman is the concierge: they remember context, decide when to handle something themselves or hand off to the right colleague, and keep you in control with approvals and a full audit trail.

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

> ⚠️ **Experimental / work in progress.** This project is not production-ready. Use with caution and only in a properly sandboxed environment.

---

## Why Hooman? ✨

You don’t manage a dozen bots. You have **one conversation** with Hooman. Want a report drafted? A meeting summarized? Research done? You say it. Hooman either does it or delegates to a colleague who can (fetch, filesystem, custom MCP servers, installed skills). You get one place to chat, schedule tasks, and see what happened—without talking to individual agents.

- **🚪 One front door** — Chat, schedule, and inspect everything through Hooman.
- **🦸 Colleagues with superpowers** — Give each colleague a role (e.g. researcher, writer) and attach MCP connections and skills. Hooman hands off when it makes sense.
- **🎛️ Under your control** — Kill switch, capability approvals, and an audit log so you see who did what and when.

---

## How it works ⚙️

| Concept             | What it is                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🤖 Hooman**       | The main agent. Reasons over memory, handles your messages and scheduled tasks, and delegates to colleagues when needed.                             |
| **👥 Colleagues**   | Role-based sub-agents you define (id, description, responsibilities). Each can have specific MCP connections and skills. Hooman routes work to them. |
| **🔌 Capabilities** | MCP servers (fetch, time, filesystem, or your own) and skills. You assign which colleagues get which capabilities.                                   |
| **🧠 Memory**       | mem0 + Qdrant so Hooman (and colleagues) can use past context.                                                                                       |

You chat with Hooman; Hooman uses memory, may call a colleague, and responds. Scheduled tasks run the same way—at a set time, Hooman processes the task like a message (reasoning, handoff, audit).

---

## Quick start 🚀

**Prerequisites:** Node.js ≥ 20, Yarn, Docker & Docker Compose (for MongoDB and Qdrant).

Clone the repo, then run the **production** stack:

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
docker compose --profile prod up
```

✅ No `.env` needed—MongoDB and Qdrant URLs are set in Compose. Open **http://localhost:5173** (or **http://localhost:3000** for the API). Set your OpenAI API key and models in **Settings**, then chat with Hooman and add Colleagues in the UI.

To run only Qdrant and MongoDB (e.g. before running the API and web app locally), use `docker compose up` with no profile.

---

## Development 🛠️

For active development with live reload:

**🐳 Docker (API + web in containers, source mounted):**

```bash
docker compose --profile dev up
```

API on port 3000, Vite dev server on 5173. Source is mounted so changes reload.

**💻 Local (API and web on your machine):**

Create a `.env` from `.env.example` and set at least `MONGO_URI` (and `QDRANT_URL` if you use memory). Optionally set `VITE_PROXY_TARGET` and `MCP_STDIO_DEFAULT_CWD` for local API. Then:

```bash
yarn install
yarn dev:all   # API :3000, UI :5173
```

Use `VITE_PROXY_TARGET=http://api-dev:3000` in `.env` if the web app runs locally but the API runs in Docker (e.g. only `api-dev` from compose).

---

## Environment 📋

When running the API and web **locally** (not via Docker), create a `.env` from `.env.example`. Key variables:

| Variable                | Required | Description                                                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`             | Yes      | MongoDB connection (e.g. `mongodb://localhost:27017` or `mongodb://mongodb:27017` in Docker).                        |
| `QDRANT_URL`            | No\*     | Qdrant URL for vector memory (e.g. `http://localhost:6333`).                                                         |
| `PORT`                  | No       | API port (default 3000).                                                                                             |
| `VITE_PROXY_TARGET`     | No       | API URL for the web dev server proxy (default `http://localhost:3000`; in Docker dev use `http://api-dev:3000`).     |
| `MCP_STDIO_DEFAULT_CWD` | No       | Working directory for stdio MCP / filesystem server (in Docker: `/app/mcp-cwd`; for local API use e.g. `./mcp-cwd`). |

\*Needed for memory; app starts without it for config and UI.

OpenAI API key, models, and web search are set in the **Settings** UI (persisted by the API), not via env.

---

## Scripts 📜

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `yarn dev`         | Start API (port 3000).               |
| `yarn dev:web`     | Start UI (port 5173).                |
| `yarn dev:all`     | Start API and UI together.           |
| `yarn build`       | Build API and web app.               |
| `yarn docker:up`   | Start infra only (Qdrant + MongoDB). |
| `yarn docker:down` | Stop Docker Compose services.        |

---

## License 📄

[GNU General Public License v3.0](LICENSE).
