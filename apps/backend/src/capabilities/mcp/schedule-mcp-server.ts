#!/usr/bin/env node
/**
 * Schedule MCP server (stdio). Exposes scheduling operations as MCP tools.
 * Directly interacts with the database (Prisma) and ScheduleStore.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { initDb } from "../../data/db.js";
import { initScheduleStore } from "../../scheduling/schedule-store.js";
import { setReloadFlag } from "../../utils/reload-flag.js";

await initDb();
const scheduleStore = await initScheduleStore();

const server = new McpServer(
  { name: "hooman-schedule", version: "1.0.0" },
  { capabilities: {} },
);

function textContent(text: string): { type: "text"; text: string }[] {
  return [{ type: "text" as const, text }];
}

server.registerTool(
  "list_scheduled_tasks",
  {
    title: "List scheduled tasks",
    description:
      "List all scheduled tasks for the user. Returns each task's id, execute_at (ISO time or placeholder for recurring), optional cron (recurring expression), intent, and optional context. Use this to see what is already scheduled before creating or canceling tasks.",
    inputSchema: z.object({}),
  },
  async () => {
    const tasks = await scheduleStore.getAll();
    if (tasks.length === 0)
      return { content: textContent("No scheduled tasks.") };
    return {
      content: textContent(
        JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            intent: t.intent,
            context: t.context,
            ...(t.execute_at ? { execute_at: t.execute_at } : {}),
            ...(t.cron ? { cron: t.cron } : {}),
          })),
          null,
          2,
        ),
      ),
    };
  },
);

server.registerTool(
  "create_scheduled_task",
  {
    title: "Create a scheduled task",
    description:
      "Create a scheduled task. One-shot: provide execute_at (ISO date-time, e.g. 2025-02-05T14:00:00Z) and the task runs once at that time. Recurring: provide cron (e.g. '*/5 * * * *' for every 5 minutes) and the task repeats. intent is required; context is optional. Use for follow-ups or deferred/recurring work.",
    inputSchema: z.object({
      execute_at: z
        .string()
        .describe(
          "When to run the task once (ISO 8601 date-time). Omit if using cron for recurring.",
        )
        .optional(),
      cron: z
        .string()
        .describe(
          "Cron expression for recurring (e.g. '*/5 * * * *' every 5 min). If set, task repeats; otherwise runs once at execute_at.",
        )
        .optional(),
      intent: z
        .string()
        .describe("Short description of what the task should do"),
      context: z
        .record(z.string(), z.unknown())
        .describe("Optional extra context (key-value object) for the task")
        .optional(),
    }),
  },
  async (args) => {
    const { execute_at, cron, intent, context = {} } = args;
    if (!intent) {
      return { content: textContent("Error: intent is required.") };
    }
    if (!execute_at && !cron) {
      return {
        content: textContent(
          "Error: provide either execute_at (one-shot) or cron (recurring).",
        ),
      };
    }

    const id = randomUUID();
    await scheduleStore.add({
      id,
      intent,
      context,
      ...(execute_at ? { execute_at } : {}),
      ...(cron ? { cron } : {}),
    });

    await setReloadFlag("schedule");

    if (cron) {
      return {
        content: textContent(
          `Scheduled recurring task with id: ${id}. Cron: ${cron}.`,
        ),
      };
    }
    return {
      content: textContent(
        `Scheduled task created with id: ${id}. It will run at ${execute_at}.`,
      ),
    };
  },
);

server.registerTool(
  "cancel_scheduled_task",
  {
    title: "Cancel a scheduled task",
    description:
      "Cancel a scheduled task by id. Use the id from list_scheduled_tasks. Returns success or that the task was not found.",
    inputSchema: z.object({
      id: z
        .string()
        .describe("The task id to cancel (from list_scheduled_tasks)"),
    }),
  },
  async (args) => {
    const { id } = args;
    if (!id) return { content: textContent("Error: id is required.") };
    const ok = await scheduleStore.remove(id);
    if (ok) {
      await setReloadFlag("schedule");
      return {
        content: textContent(`Scheduled task ${id} has been cancelled.`),
      };
    }
    return {
      content: textContent(`Scheduled task with id "${id}" was not found.`),
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
