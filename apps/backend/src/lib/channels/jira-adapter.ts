/**
 * Jira channel adapter: poll Jira REST API for issues (e.g. assigned to user),
 * dispatch message.sent with channelMeta. Inbound only. Run via cron worker.
 */
import createDebug from "debug";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type {
  EventDispatcher,
  JiraChannelMeta,
  JiraChannelConfig,
} from "../core/types.js";
import { WORKSPACE_ROOT } from "../core/workspace.js";

const debug = createDebug("hooman:jira-adapter");

const STATE_FILE = join(WORKSPACE_ROOT, "jira-last-seen.json");
const MAX_TRACKED_KEYS = 500;
const DEFAULT_JQL = "assignee = currentUser() ORDER BY updated DESC";
const DEFAULT_POLL_MS = 300_000; // 5 min

interface JiraState {
  lastPoll: string;
  byKey: Record<string, string>;
}

async function loadState(): Promise<JiraState> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    const data = JSON.parse(raw) as JiraState;
    if (data && typeof data.byKey === "object") return data;
  } catch {
    // no file or invalid
  }
  return { lastPoll: new Date(0).toISOString(), byKey: {} };
}

async function saveState(state: JiraState): Promise<void> {
  const keys = Object.keys(state.byKey);
  if (keys.length > MAX_TRACKED_KEYS) {
    const entries = keys
      .map((k) => [k, state.byKey[k]] as const)
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
    state.byKey = Object.fromEntries(entries.slice(0, MAX_TRACKED_KEYS));
  }
  try {
    await writeFile(STATE_FILE, JSON.stringify(state), "utf-8");
  } catch (e) {
    debug("saveState error: %o", e);
  }
}

function applyFilter(config: JiraChannelConfig, projectKey: string): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = (config.filterList ?? []).map((x) => x.trim().toUpperCase());
  const inList = list.includes(projectKey.toUpperCase());
  if (mode === "allowlist") return inList;
  return !inList; // blocklist
}

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: string | { type: string; content?: unknown[] };
    assignee?: { accountId: string; displayName?: string };
    reporter?: { accountId?: string; displayName?: string };
    updated?: string;
    project?: { key: string };
    status?: { name?: string };
  };
}

function descriptionToText(f: JiraIssue["fields"]): string {
  const d = f.description;
  if (typeof d === "string") return d.slice(0, 2000);
  if (d && typeof d === "object" && Array.isArray(d.content)) {
    const text = (d.content as { type: string; text?: string }[])
      .filter((c) => c.type === "paragraph" && c.text)
      .map((c) => c.text)
      .join("\n");
    return text.slice(0, 2000);
  }
  return "";
}

export async function runJiraPoll(
  dispatcher: EventDispatcher,
  config: JiraChannelConfig | undefined,
): Promise<void> {
  if (
    !config?.enabled ||
    !config.baseUrl?.trim() ||
    !config.email?.trim() ||
    !config.apiToken?.trim()
  ) {
    if (config?.enabled)
      debug("Jira adapter: disabled or missing baseUrl/email/apiToken");
    return;
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const auth = Buffer.from(
    `${config.email.trim()}:${config.apiToken.trim()}`,
  ).toString("base64");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Basic ${auth}`,
  };

  let accountId: string | undefined;
  try {
    const myselfRes = await fetch(`${baseUrl}/rest/api/3/myself`, { headers });
    if (myselfRes.ok) {
      const me = (await myselfRes.json()) as { accountId?: string };
      accountId = me.accountId;
    }
  } catch (e) {
    debug("Jira myself failed: %o", e);
    return;
  }

  const jql = (config.jql ?? DEFAULT_JQL).trim() || DEFAULT_JQL;
  const searchUrl = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,description,assignee,reporter,updated,project,status&maxResults=50`;
  let issues: JiraIssue[];
  try {
    const res = await fetch(searchUrl, { headers });
    if (!res.ok) {
      debug("Jira search failed: %s %s", res.status, await res.text());
      return;
    }
    const data = (await res.json()) as { issues?: JiraIssue[] };
    issues = data.issues ?? [];
  } catch (e) {
    debug("Jira search error: %o", e);
    return;
  }

  const state = await loadState();
  const now = new Date().toISOString();
  let dispatched = 0;

  for (const issue of issues) {
    const key = issue.key;
    const projectKey = issue.fields?.project?.key ?? "";
    if (!applyFilter(config, projectKey)) continue;

    const reporter = issue.fields?.reporter;
    if (accountId && reporter?.accountId === accountId) {
      if (state.byKey[key] !== updated) {
        debug(
          "Ignoring Jira issue created by self (reporter), not queuing: key=%s",
          key,
        );
      }
      state.byKey[key] = updated;
      continue;
    }

    const updated = issue.fields?.updated ?? now;
    if (state.byKey[key] === updated) continue;

    const summary = issue.fields?.summary ?? "(no summary)";
    const desc = descriptionToText(issue.fields);
    const text = `[Jira] ${key}: ${summary}${desc ? `\n\n${desc}` : ""}`;
    const userId = `jira:${projectKey}:${key}`;

    const assignee = issue.fields?.assignee;
    const isAssignedToMe = !!accountId && assignee?.accountId === accountId;
    const directness = isAssignedToMe ? "direct" : "neutral";
    const directnessReason = isAssignedToMe ? "assigned" : "project_activity";

    const channelMeta: JiraChannelMeta = {
      channel: "jira",
      destinationType: "issue",
      issueKey: key,
      projectKey,
      messageId: `${key}#${updated}`,
      senderId:
        assignee?.accountId ??
        reporter?.accountId ??
        reporter?.displayName ??
        "",
      senderName: assignee?.displayName ?? reporter?.displayName,
      directness,
      directnessReason,
    };

    await dispatcher.dispatch(
      {
        source: "jira",
        type: "message.sent",
        payload: {
          text,
          userId,
          channelMeta,
        },
      },
      {},
    );
    state.byKey[key] = updated;
    dispatched += 1;
    debug("Jira message.sent dispatched: key=%s", key);
  }

  state.lastPoll = now;
  await saveState(state);
  if (dispatched > 0)
    debug("Jira poll done; dispatched %s issue(s)", dispatched);
  else if (issues.length === 0) debug("Jira poll: no issues matching JQL");
}
