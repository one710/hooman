/**
 * WhatsApp channel adapter: whatsapp-web.js (Puppeteer-backed), listens for incoming
 * messages, dispatches message.sent with channelMeta. Inbound only.
 * Handles text messages and voice notes (PTT); transcribes voice and dispatches with sourceMessageType: 'audio'.
 */
import createDebug from "debug";
import { join } from "path";
import type {
  EventDispatcher,
  WhatsAppChannelMeta,
  WhatsAppChannelConfig,
} from "../types.js";
import { WORKSPACE_ROOT } from "../workspace.js";
import { env } from "../env.js";
import { transcribeAudio } from "../agents/transcription.js";
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

import { applyFilter } from "./shared.js";

function applyWhatsAppFilter(
  config: WhatsAppChannelConfig,
  chatId: string,
): boolean {
  const idLower = chatId.toLowerCase();
  return applyFilter(config, (entry) => {
    const e = entry.toLowerCase();
    return (
      idLower === e ||
      idLower === e.replace(/@.*$/, "") + "@c.us" ||
      idLower.endsWith(e)
    );
  });
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
    // Self-identity from logged-in client
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
      const chatId = message.from;
      if (!applyWhatsAppFilter(cfg, chatId)) {
        debug("WhatsApp message filtered out: chatId=%s", chatId);
        return;
      }

      // Voice note (PTT): no text, transcribe and dispatch with sourceMessageType: 'audio'
      const messageType = (message as { type?: string }).type;
      if (!text && messageType === "ptt" && message.hasMedia) {
        try {
          const media = await message.downloadMedia();
          if (!media?.data) {
            debug("WhatsApp voice note: no media data");
            return;
          }
          const buffer = Buffer.from(media.data, "base64");
          const transcribedText = (
            await transcribeAudio(buffer, { mimeType: media.mimetype })
          ).trim();
          if (!transcribedText) {
            debug("WhatsApp voice transcription returned empty text");
            return;
          }
          const isDirect = chatId.endsWith("@c.us");
          const destinationType = isDirect ? "dm" : "group";
          const directness: "direct" | "neutral" = isDirect
            ? "direct"
            : "neutral";
          const directnessReason = isDirect ? "dm" : "group";
          const messageId =
            typeof message.id === "object" && message.id && "id" in message.id
              ? String((message.id as { id?: string }).id ?? message.id)
              : String(message.id);
          const channelMeta: WhatsAppChannelMeta = {
            channel: "whatsapp",
            chatId,
            messageId,
            destinationType,
            directness,
            directnessReason,
            ...((message as { _data?: { notifyName?: string } })._data
              ?.notifyName
              ? {
                  pushName: (message as { _data?: { notifyName?: string } })
                    ._data?.notifyName,
                }
              : {}),
          };
          const userId = `whatsapp:${chatId}`;
          await dispatcher.dispatch(
            {
              source: "whatsapp",
              type: "message.sent",
              payload: {
                text: transcribedText,
                userId,
                channelMeta,
                sourceMessageType: "audio" as const,
              },
            },
            {},
          );
          debug(
            "WhatsApp message.sent dispatched (voice): chatId=%s id=%s",
            chatId,
            messageId,
          );
        } catch (err) {
          debug("WhatsApp voice transcription failed: %o", err);
        }
        return;
      }

      if (!text) return;

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

/**
 * Send a text message to a WhatsApp chat. Used by response delivery (event-queue publishes; whatsapp worker subscribes).
 */
export async function sendMessageToChat(
  chatId: string,
  text: string,
): Promise<void> {
  const c = client;
  if (!c) {
    throw new Error("WhatsApp adapter not connected; cannot send message");
  }
  await c.sendMessage(chatId, text);
}

function serializedChatId(id: unknown): string {
  if (id && typeof id === "object" && "_serialized" in id)
    return String((id as { _serialized: string })._serialized);
  return String(id);
}

/** MCP request handler: runs WhatsApp operations using the active adapter connection. Returns serializable result or throws. */
export async function handleWhatsAppMcpRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const c = client;
  if (!c) {
    throw new Error("WhatsApp adapter not connected; cannot run MCP operation");
  }

  switch (method) {
    case "chats_list": {
      const chats = await c.getChats();
      return {
        chats: chats.map((chat) => ({
          id: serializedChatId(chat.id),
          name: chat.name,
          isGroup: chat.isGroup,
          archived: chat.archived,
          pinned: chat.pinned,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp,
        })),
      };
    }
    case "chat_info": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      if (!chatId) throw new Error("chatId is required");
      const chat = await c.getChatById(chatId);
      const base = {
        id: serializedChatId(chat.id),
        name: chat.name,
        isGroup: chat.isGroup,
        archived: chat.archived,
        pinned: chat.pinned,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
      };
      if (
        chat.isGroup &&
        "participants" in chat &&
        Array.isArray(
          (chat as unknown as { participants: unknown[] }).participants,
        )
      ) {
        const participants = (
          chat as unknown as {
            participants: {
              id: unknown;
              isAdmin?: boolean;
              isSuperAdmin?: boolean;
            }[];
          }
        ).participants;
        return {
          ...base,
          participants: participants.map((p) => ({
            id: serializedChatId(p.id),
            isAdmin: p.isAdmin,
            isSuperAdmin: p.isSuperAdmin,
          })),
        };
      }
      return base;
    }
    case "contacts_list": {
      const contacts = await c.getContacts();
      return {
        contacts: contacts.map((contact) => ({
          id: serializedChatId(contact.id),
          name: contact.name,
          number:
            contact.id && typeof contact.id === "object" && "user" in contact.id
              ? (contact.id as { user: string }).user
              : undefined,
        })),
      };
    }
    case "contact_info": {
      const contactId =
        typeof params.contactId === "string" ? params.contactId : "";
      if (!contactId) throw new Error("contactId is required");
      const contact = await c.getContactById(contactId);
      return {
        id: serializedChatId(contact.id),
        name: contact.name,
        number:
          contact.id && typeof contact.id === "object" && "user" in contact.id
            ? (contact.id as { user: string }).user
            : undefined,
      };
    }
    case "chat_participants": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      if (!chatId) throw new Error("chatId is required");
      const chat = await c.getChatById(chatId);
      if (!chat.isGroup) return { participants: [] };
      const participants = (
        chat as unknown as {
          participants: {
            id: unknown;
            isAdmin?: boolean;
            isSuperAdmin?: boolean;
          }[];
        }
      ).participants;
      return {
        participants: participants.map((p) => ({
          id: serializedChatId(p.id),
          isAdmin: p.isAdmin,
          isSuperAdmin: p.isSuperAdmin,
        })),
      };
    }
    case "send_message": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      const text = typeof params.text === "string" ? params.text : "";
      if (!chatId || !text) throw new Error("chatId and text are required");
      const msg = await c.sendMessage(chatId, text);
      const msgId =
        msg.id && typeof msg.id === "object" && "id" in msg.id
          ? String((msg.id as { id?: string }).id ?? msg.id)
          : String(msg.id);
      return { ok: true, messageId: msgId };
    }
    case "send_media": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      const data = typeof params.data === "string" ? params.data : "";
      const mimetype =
        typeof params.mimetype === "string"
          ? params.mimetype
          : "application/octet-stream";
      const filename =
        typeof params.filename === "string" ? params.filename : undefined;
      const caption =
        typeof params.caption === "string" ? params.caption : undefined;
      if (!chatId || !data)
        throw new Error("chatId and data (base64) are required");
      const { MessageMedia } = await import("whatsapp-web.js");
      const media = new MessageMedia(mimetype, data, filename ?? undefined);
      const msg = await c.sendMessage(chatId, media, {
        caption: caption ?? undefined,
      });
      const msgId =
        msg.id && typeof msg.id === "object" && "id" in msg.id
          ? String((msg.id as { id?: string }).id ?? msg.id)
          : String(msg.id);
      return { ok: true, messageId: msgId };
    }
    case "reply_to_message": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      const messageId =
        typeof params.messageId === "string" ? params.messageId : "";
      const text = typeof params.text === "string" ? params.text : "";
      if (!messageId || !text)
        throw new Error("messageId and text are required");
      const quoted = await c.getMessageById(messageId);
      if (!quoted) throw new Error("Message not found");
      const msg = await quoted.reply(text, chatId || undefined);
      const msgId =
        msg.id && typeof msg.id === "object" && "id" in msg.id
          ? String((msg.id as { id?: string }).id ?? msg.id)
          : String(msg.id);
      return { ok: true, messageId: msgId };
    }
    case "get_chat_messages": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      const limit = Math.min(Math.max(1, Number(params.limit) || 50), 100);
      if (!chatId) throw new Error("chatId is required");
      const chat = await c.getChatById(chatId);
      const messages = await (
        chat as {
          fetchMessages: (opts: { limit?: number }) => Promise<unknown[]>;
        }
      ).fetchMessages({ limit });
      return {
        messages: messages.map((m: unknown) => {
          const msg = m as {
            id?: unknown;
            body?: string;
            from?: string;
            timestamp?: number;
            fromMe?: boolean;
            type?: string;
          };
          return {
            id:
              msg.id && typeof msg.id === "object" && "id" in msg.id
                ? String((msg.id as { id?: string }).id ?? msg.id)
                : String(msg.id),
            body: msg.body ?? "",
            from: msg.from,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            type: msg.type,
          };
        }),
      };
    }
    case "react_to_message": {
      const messageId =
        typeof params.messageId === "string" ? params.messageId : "";
      const emoji = typeof params.emoji === "string" ? params.emoji : "👍";
      if (!messageId) throw new Error("messageId is required");
      const msg = await c.getMessageById(messageId);
      if (!msg) throw new Error("Message not found");
      await (msg as { react: (reaction: string) => Promise<void> }).react(
        emoji,
      );
      return { ok: true };
    }
    case "send_typing": {
      const chatId = typeof params.chatId === "string" ? params.chatId : "";
      if (!chatId) throw new Error("chatId is required");
      const chat = await c.getChatById(chatId);
      await (
        chat as { sendStateTyping: () => Promise<void> }
      ).sendStateTyping();
      return { ok: true };
    }
    default:
      throw new Error(`Unknown WhatsApp MCP method: ${method}`);
  }
}
