/**
 * WhatsApp channel adapter: whatsapp-web.js (Puppeteer-backed), listens for incoming
 * messages, dispatches message.sent with channelMeta. Inbound only.
 */
import createDebug from "debug";
import { join } from "path";
import type {
  EventDispatcher,
  WhatsAppChannelMeta,
  WhatsAppChannelConfig,
} from "../core/types.js";
import { WORKSPACE_ROOT } from "../core/workspace.js";
import { env } from "../../env.js";
import wweb from "whatsapp-web.js";

const { Client, LocalAuth } = wweb;
const debug = createDebug("hooman:whatsapp-adapter");

let client: InstanceType<typeof Client> | null = null;

/** Session path in config is a folder name only; actual path is always WORKSPACE_ROOT/whatsapp/<name>. */
function getAuthFolder(config: WhatsAppChannelConfig): string {
  const name = config.sessionPath?.trim();
  const folderName =
    name && !name.includes("/") && !name.includes("..") ? name : "default";
  return join(WORKSPACE_ROOT, "whatsapp", folderName);
}

function applyFilter(config: WhatsAppChannelConfig, chatId: string): boolean {
  const mode = config.filterMode ?? "all";
  if (mode === "all") return true;
  const list = (config.filterList ?? []).map((s) => s.trim().toLowerCase());
  const idLower = chatId.toLowerCase();
  const match = list.some(
    (entry) =>
      idLower === entry ||
      idLower === entry.replace(/@.*$/, "") + "@c.us" ||
      idLower.endsWith(entry),
  );
  if (mode === "allowlist") return match;
  return !match;
}

export interface WhatsAppAdapterOptions {
  /** Called when connection state or QR changes; worker can POST to API so the UI can show the QR. When connected, includes self identity (logged-in number). */
  onConnectionUpdate?: (data: {
    status: "disconnected" | "pairing" | "connected";
    qr?: string;
    /** Logged-in user ID (e.g. 1234567890@c.us). */
    selfId?: string;
    /** Display number (e.g. +1234567890). */
    selfNumber?: string;
  }) => void;
}

export async function startWhatsAppAdapter(
  dispatcher: EventDispatcher,
  getWhatsAppConfig: () => WhatsAppChannelConfig | undefined,
  options?: WhatsAppAdapterOptions,
): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config?.enabled) {
    debug("Adapter not started: channel is disabled in Settings");
    return;
  }

  await stopWhatsAppAdapter();

  const authFolder = getAuthFolder(config);
  debug(
    "Adapter starting (session: %s); waiting for QR or existing session…",
    authFolder,
  );

  const { onConnectionUpdate } = options ?? {};
  const notify = (
    status: "disconnected" | "pairing" | "connected",
    qr?: string,
    self?: { selfId: string; selfNumber?: string },
  ) => {
    try {
      onConnectionUpdate?.({ status, qr, ...self });
    } catch (e) {
      debug("onConnectionUpdate error: %o", e);
    }
  };

  const executablePath =
    env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: authFolder }),
    puppeteer: {
      executablePath: executablePath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
  });

  let selfIdForMeta: string | undefined;
  client.on("qr", (qr: string) => {
    debug("QR received, sending to Settings UI");
    notify("pairing", qr);
  });

  client.on("ready", () => {
    if (!client) return;
    // Self-identity from logged-in client (like Jira currentUser())
    const info = client.info as
      | { wid?: { _serialized?: string; user?: string } }
      | undefined;
    const wid = info?.wid;
    const selfIdRaw =
      wid && typeof wid === "object" && "_serialized" in wid
        ? (wid as { _serialized?: string })._serialized
        : undefined;
    const selfId = typeof selfIdRaw === "string" ? selfIdRaw : "";
    selfIdForMeta = selfId || undefined;
    const userPart =
      wid && typeof wid === "object" && "user" in wid
        ? (wid as { user?: string }).user
        : undefined;
    const selfNumber =
      typeof userPart === "string" && userPart
        ? userPart.startsWith("+")
          ? userPart
          : `+${userPart}`
        : undefined;
    debug(
      "Linked; client ready (self: %s)",
      selfId || selfNumber || "(unknown)",
    );
    notify("connected", undefined, selfId ? { selfId, selfNumber } : undefined);
  });

  client.on("authenticated", () => {
    debug("WhatsApp authenticated");
  });

  client.on("auth_failure", (msg: string) => {
    debug("Auth failure: %s", msg);
    notify("disconnected");
  });

  client.on("disconnected", (reason: string) => {
    debug("Disconnected: %s", reason);
    notify("disconnected");
  });

  client.on(
    "message_create",
    async (message: import("whatsapp-web.js").Message) => {
      const cfg = getWhatsAppConfig();
      if (!cfg?.enabled) return;
      if (message.fromMe) {
        debug(
          "Ignoring WhatsApp message from self (fromMe), not queuing: chatId=%s",
          message.from,
        );
        return;
      }

      const text = typeof message.body === "string" ? message.body.trim() : "";
      if (!text) return;

      const chatId = message.from;
      if (!applyFilter(cfg, chatId)) {
        debug("WhatsApp message filtered out: chatId=%s", chatId);
        return;
      }

      const isDirect = chatId.endsWith("@c.us");
      const destinationType = isDirect ? "dm" : "group";
      const directness: "direct" | "neutral" = isDirect ? "direct" : "neutral";
      const directnessReason = isDirect ? "dm" : "group";
      const messageId =
        typeof message.id === "object" && message.id && "id" in message.id
          ? String((message.id as { id?: string }).id ?? message.id)
          : String(message.id);

      const mentionedIds = Array.isArray(
        (message as { mentionedIds?: string[] }).mentionedIds,
      )
        ? ((message as { mentionedIds: string[] }).mentionedIds as string[])
        : [];
      const selfMentioned =
        !!selfIdForMeta && mentionedIds.includes(selfIdForMeta);

      let originalMessage: WhatsAppChannelMeta["originalMessage"] = undefined;
      if (message.hasQuotedMsg) {
        try {
          const quoted = await message.getQuotedMessage();
          if (quoted) {
            originalMessage = {
              senderId: quoted.author ?? undefined,
              content:
                typeof quoted.body === "string" ? quoted.body : undefined,
              messageId:
                typeof quoted.id === "object" && quoted.id && "id" in quoted.id
                  ? String((quoted.id as { id?: string }).id ?? quoted.id)
                  : String(quoted.id),
            };
          }
        } catch {
          // ignore quoted message errors (e.g. buttons_response type)
        }
      }

      const channelMeta: WhatsAppChannelMeta = {
        channel: "whatsapp",
        chatId,
        messageId,
        destinationType,
        directness,
        directnessReason,
        ...(mentionedIds.length > 0 ? { mentionedIds } : {}),
        ...(selfMentioned ? { selfMentioned: true } : {}),
        ...((message as { _data?: { notifyName?: string } })._data?.notifyName
          ? {
              pushName: (message as { _data?: { notifyName?: string } })._data
                ?.notifyName,
            }
          : {}),
        ...(originalMessage ? { originalMessage } : {}),
      };

      const userId = `whatsapp:${chatId}`;
      debug("New message received from %s", chatId);
      await dispatcher.dispatch(
        {
          source: "whatsapp",
          type: "message.sent",
          payload: { text, userId, channelMeta },
        },
        {},
      );
      debug(
        "WhatsApp message.sent dispatched: chatId=%s id=%s",
        chatId,
        messageId,
      );
    },
  );

  await client.initialize();
  debug("WhatsApp adapter started (session: %s)", authFolder);
}

export async function stopWhatsAppAdapter(): Promise<void> {
  if (client) {
    await client.destroy();
    client = null;
    debug("WhatsApp adapter stopped");
  }
}
