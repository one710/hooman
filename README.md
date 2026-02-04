# Hooman

**Hooman** is an event-driven autonomous system that reasons over memory, delegates to config-defined Colleagues, and operates through a conversational UI. It is built to be explainable and controllable: you chat with Hooman, manage Colleagues and schedules, and inspect decisions and actions in an audit log.

---

## What it is

- **Primary agent (Hooman)** — A single reasoning layer that receives events (chat messages, scheduled tasks), consults memory (mem0 + Qdrant), and decides whether to respond directly, delegate to a Colleague, ask for approval, or ignore.
- **Colleagues** — Role-defined sub-agents configured entirely via the UI or API (id, description, responsibilities). Hooman can hand off conversations to them when appropriate; handoffs are executed via the OpenAI Agents SDK.
- **React UI** — The main way to interact: chat with Hooman, manage Colleagues, create and cancel scheduled tasks, view the audit log, toggle a global kill switch, and configure API key and models in Settings.

The stack is TypeScript (Node.js API + React + Vite + Tailwind), with MongoDB for chat history and Colleagues, Qdrant for vector memory (mem0), and an internal scheduler whose tasks are persisted in MongoDB.

---

## Purpose

- **Delegate work** — You tell Hooman what you want; it can answer itself or hand off to a Colleague.
- **Stay in control** — Global kill switch pauses all processing; capability approvals and a full audit log keep actions visible.
- **Run continuously** — Scheduler fires tasks at set times; each task is processed like a chat message (reasoning, memory, optional handoff).

---

## Implemented features

- **Chat** — Send messages to Hooman. Chat history is stored (MongoDB when available; otherwise in-memory). Memory search (mem0) and Colleague handoffs run when configured.
- **Colleagues** — Add, edit, and remove Colleagues (MongoDB). Each has id, description, responsibilities; Hooman can delegate to one by id.
- **Scheduling** — Create one-off scheduled tasks (execute-at time, intent, optional context). Stored in MongoDB; when the scheduler fires, the task is processed like a user message (memory + LLM + optional handoff). Cancel with confirmation.
- **Audit log** — In-memory log of decisions, responses, capability requests, scheduled tasks, and agent runs. Each entry type shows relevant detail (e.g. input prompt, response, “Responded by”, handoffs for agent runs; triggered-by and reasoning for decisions).
- **Safety** — Global kill switch (Hooman paused / resumed). List and approve/revoke capabilities (integration + capability); grant/revoke is API-backed, list visible in Safety UI.
- **Settings** — Configure OpenAI API key, LLM model, embedding model, and web search (persisted via API). Qdrant URL and port are env-only.
- **Memory** — mem0 with Qdrant for vector store. When API key or Qdrant is missing, the API still starts with a no-op memory so the UI (e.g. Settings) works. Mem0 history DB (SQLite) is stored under the API `data/` directory.
- **MCP client layer** — Capability grant/revoke and a stub for tool calls (no real MCP server connections yet).
- **Event router** — Normalizes, deduplicates, and prioritizes events (e.g. UI messages, scheduler) and dispatches to the Hooman runtime.

---

## How to run

### Prerequisites

- **Node.js** ≥ 20
- **Yarn** (package manager)
- **Docker** and **Docker Compose** (for running with Redis, Qdrant, MongoDB)

### Local (no Docker)

1. Clone the repo and install dependencies:

   ```bash
   yarn install
   ```

2. Create a `.env` in the project root (see [Environment](#environment)). At minimum, set `MONGO_URI` and `QDRANT_URL` if you want persistence and memory. Configure OpenAI API key and models in the **Settings** UI after starting.

3. Start the API and the web app (two terminals, or use `yarn dev:all`):

   ```bash
   yarn dev        # API on http://localhost:3000
   yarn dev:web    # UI on http://localhost:5173
   ```

4. Open **http://localhost:5173** and use Chat, Colleagues, Schedule, Audit, Safety, and Settings as needed.

### Docker (recommended)

The app runs with Redis, Qdrant, and MongoDB via Docker Compose. Use profiles to choose dev or prod.

| Mode        | Command                            | Result                                                                                                             |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Development | `docker compose --profile dev up`  | Redis, Qdrant, MongoDB, API (tsx watch), Web (Vite). Ports: 3000 (API), 5173 (UI). Mounted source for live reload. |
| Production  | `docker compose --profile prod up` | Redis, Qdrant, MongoDB, API (built), Web (built React via nginx). Ports: 3000 (API), 5173 (nginx).                 |

Without a profile, `docker compose up` starts only Redis, Qdrant, and MongoDB (shared infrastructure).

Create a `.env` with at least `MONGO_URI` (e.g. `mongodb://mongodb:27017` when using the compose MongoDB service). Other variables are documented below.

---

## Environment

| Variable     | Required | Description                                                                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`  | Yes      | MongoDB connection string (e.g. `mongodb://localhost:27017` or `mongodb://mongodb:27017` in Docker).                            |
| `QDRANT_URL` | No\*     | Qdrant URL (e.g. `http://localhost:6333`). If omitted (and no API key in Settings), memory is a no-op and the API still starts. |
| `PORT`       | No       | API port (default 3000).                                                                                                        |

OpenAI API key, LLM model, and embedding model are **configurable only via the Settings UI** (persisted by the API). They are not read from environment variables.

\*Required for full functionality (memory + LLM), but the app can start without it for configuration and UI.

Copy `.env.example` to `.env` and adjust. The example includes commented placeholders for `MONGO_URI`, `QDRANT_URL`, and `PORT`.

---

## How to use

- **Chat** — Type a message and send. Replies may come from Hooman or a Colleague (shown as “Responded by …”). Use “Clear chat” to wipe history (and, when using the default context, clear stored memory for that user).
- **Colleagues** — Add a Colleague (id, description, responsibilities). Edit or delete existing ones. Hooman uses these when deciding to delegate.
- **Schedule** — Create a task with date/time, intent, and optional context. It runs once at that time and is processed like a chat message. You can cancel a task (with confirmation).
- **Audit** — Browse the in-memory audit log: agent runs (input, response, who responded, handoffs), responses, decisions (with “Triggered by” when present), capability requests, scheduled tasks, etc. Log resets on API restart.
- **Safety** — See API status, turn the global kill switch on (Hooman paused) or off, and view currently approved capabilities (grant/revoke is via API).
- **Settings** — Set OpenAI API key, LLM model, embedding model, and web search. These are persisted by the API.

---

## Scripts

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `yarn dev`         | Start API (port 3000).                           |
| `yarn dev:web`     | Start UI (port 5173).                            |
| `yarn dev:all`     | Start API and UI concurrently.                   |
| `yarn build`       | Build API and web app.                           |
| `yarn docker:up`   | `docker compose up -d` (no profile: infra only). |
| `yarn docker:down` | `docker compose down`.                           |

---

## License

This project is licensed under the **GNU General Public License v3.0**. See [LICENSE](LICENSE) for the full text.
