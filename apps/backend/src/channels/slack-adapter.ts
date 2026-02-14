/**
 * Slack channel adapter: Socket Mode, listens for messages in DMs/channels/groups
 * where the app is present, dispatches message.sent with channelMeta. Inbound only.
 * Handles text messages only.
 */
import createDebug from "debug";
import type {
  EventDispatcher,
  SlackChannelMeta,
  SlackChannelConfig,
} from "../types.js";

const debug = createDebug("hooman:slack-adapter");

let slackApp: import("@slack/bolt").App | null = null;

import { applyFilter } from "./shared.js";

function applySlackFilter(
  config: SlackChannelConfig,
  channelId: string,
  userId: string,
  isDm: boolean,
): boolean {
  const id = isDm ? userId : channelId;
  return applyFilter(config, (entry) => entry === id);
}

export async function startSlackAdapter(
  dispatcher: EventDispatcher,
  getSlackConfig: () => SlackChannelConfig | undefined,
): Promise<void> {
  const config = getSlackConfig();
  if (
    !config?.enabled ||
    !config.appToken?.trim() ||
    !config.userToken?.trim()
  ) {
    debug("Slack adapter not started: disabled or missing appToken/userToken");
    return;
  }

  const { App } = await import("@slack/bolt");
  const app = new App({
    appToken: config.appToken.trim(),
    token: config.userToken.trim(),
    socketMode: true,
  });

  let designatedUserId = config.designatedUserId?.trim();
  if (!designatedUserId) {
    try {
      const auth = await app.client.auth.test();
      designatedUserId = (auth as { user_id?: string }).user_id ?? "";
    } catch (e) {
      debug("auth.test failed, designatedUserId unknown: %o", e);
    }
  }

  /** Extract Slack user IDs mentioned in text (<@U123>). */
  function extractMentionedIds(text: string): string[] {
    const ids: string[] = [];
    const re = /<@([A-Z0-9]+)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = m[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  app.message(async ({ message, client }) => {
    if (
      message.subtype === "bot_message" ||
      (message as { bot_id?: string }).bot_id
    ) {
      debug(
        "Ignoring Slack message from self (bot), not queuing: channel=%s",
        (message as { channel?: string }).channel,
      );
      return;
    }
    const text =
      typeof (message as { text?: string }).text === "string"
        ? (message as { text: string }).text
        : "";

    const channelId = (message as { channel: string }).channel;
    const messageTs = (message as { ts: string }).ts;
    const threadTs = (message as { thread_ts?: string }).thread_ts;
    const userIdFromSlack = (message as { user?: string }).user ?? "";

    if (designatedUserId && userIdFromSlack === designatedUserId) {
      debug(
        "Ignoring Slack message from self (designated user), not queuing: channel=%s user=%s",
        channelId,
        userIdFromSlack,
      );
      return;
    }

    const isDm = channelId.startsWith("D");
    if (!applySlackFilter(config, channelId, userIdFromSlack, isDm)) {
      debug(
        "Slack message filtered out: channel=%s user=%s",
        channelId,
        userIdFromSlack,
      );
      return;
    }

    if (!text.trim()) return;

    const userId = threadTs
      ? `slack:${channelId}:${threadTs}`
      : `slack:${channelId}`;

    const mentionedIds = extractMentionedIds(text);
    const selfMentioned =
      !!designatedUserId && mentionedIds.includes(designatedUserId);
    const isDirect =
      isDm ||
      (typeof (message as { text?: string }).text === "string" &&
        designatedUserId &&
        (message as { text: string }).text.includes(`<@${designatedUserId}>`));
    const directness = isDirect ? "direct" : "neutral";
    const directnessReason = isDm
      ? "dm"
      : isDirect
        ? "mention"
        : channelId.startsWith("G")
          ? "group_message"
          : "channel_message";

    const destinationType = isDm
      ? "dm"
      : channelId.startsWith("G")
        ? "group"
        : "channel";

    let senderName: string | undefined;
    try {
      const u = await client.users.info({ user: userIdFromSlack });
      senderName = (u.user as { real_name?: string })?.real_name;
    } catch {
      // ignore
    }

    let originalMessage: SlackChannelMeta["originalMessage"];
    if (threadTs && threadTs !== messageTs) {
      try {
        const thread = await client.conversations.history({
          channel: channelId,
          latest: threadTs,
          limit: 1,
          inclusive: true,
        });
        const parent = thread.messages?.[0] as
          | { user?: string; text?: string; ts?: string }
          | undefined;
        if (parent) {
          let parentSenderName: string | undefined;
          try {
            const pu = await client.users.info({ user: parent.user ?? "" });
            parentSenderName = (pu.user as { real_name?: string })?.real_name;
          } catch {
            // ignore
          }
          originalMessage = {
            senderId: parent.user,
            senderName: parentSenderName,
            content: parent.text,
            messageId: parent.ts,
            timestamp: parent.ts,
          };
        }
      } catch {
        // ignore
      }
    }

    const channelMeta: SlackChannelMeta = {
      channel: "slack",
      channelId,
      messageTs,
      senderId: userIdFromSlack,
      destinationType,
      directness,
      directnessReason,
      ...(threadTs ? { threadTs } : {}),
      ...(senderName ? { senderName } : {}),
      ...(mentionedIds.length > 0 ? { mentionedIds } : {}),
      ...(selfMentioned ? { selfMentioned: true } : {}),
      ...(originalMessage ? { originalMessage } : {}),
    };

    await dispatcher.dispatch(
      {
        source: "slack",
        type: "message.sent",
        payload: { text: text.trim(), userId, channelMeta },
      },
      {},
    );
    debug(
      "Slack message.sent dispatched: channel=%s ts=%s",
      channelId,
      messageTs,
    );
  });

  await app.start();
  slackApp = app;
  debug("Slack adapter started (Socket Mode)");
}

export async function stopSlackAdapter(): Promise<void> {
  if (slackApp) {
    await slackApp.stop();
    slackApp = null;
    debug("Slack adapter stopped");
  }
}
