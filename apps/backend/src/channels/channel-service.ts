import { getChannelsConfig, updateChannelsConfig } from "../config.js";
import { setReloadFlags, type ReloadScope } from "../utils/reload-flag.js";
import { getRedis } from "../data/redis.js";
import { requestResponse } from "../utils/pubsub.js";
import type { ChannelsConfig } from "../types.js";
import type { WhatsAppConnection } from "./whatsapp-adapter.js";
import { mask, isMasked } from "../utils/helpers.js";

const WHATSAPP_CONNECTION_REQUEST_CHANNEL =
  "hooman:whatsapp:connection:request";
const WHATSAPP_CONNECTION_RESPONSE_CHANNEL =
  "hooman:whatsapp:connection:response";
const WHATSAPP_CONNECTION_RPC_TIMEOUT_MS = 5000;

export interface ChannelService {
  getChannels(): any;
  updateChannels(body: Partial<ChannelsConfig>): Promise<void>;
  getWhatsAppConnection(): Promise<
    WhatsAppConnection | { status: "disconnected" }
  >;
}

export function createChannelService(): ChannelService {
  return {
    getChannels() {
      const channels = getChannelsConfig();
      return {
        web: {
          id: "web",
          name: "Web chat",
          alwaysOn: true,
          config: null,
        },
        slack: channels.slack
          ? {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: channels.slack.enabled,
              config: {
                ...channels.slack,
                appToken: mask(channels.slack.appToken),
                userToken: mask(channels.slack.userToken),
              },
            }
          : {
              id: "slack",
              name: "Slack",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
        whatsapp: channels.whatsapp
          ? {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: channels.whatsapp.enabled,
              config: channels.whatsapp,
            }
          : {
              id: "whatsapp",
              name: "WhatsApp",
              alwaysOn: false,
              enabled: false,
              config: null,
            },
      };
    },

    async updateChannels(body) {
      const current = getChannelsConfig();
      const patch: ChannelsConfig = { ...current };

      if (body.slack !== undefined) {
        const b = body.slack as ChannelsConfig["slack"];
        const c = current.slack;
        patch.slack = {
          ...c,
          ...b,
          appToken: isMasked(b?.appToken)
            ? (c?.appToken ?? b?.appToken)
            : b?.appToken,
          userToken: isMasked(b?.userToken)
            ? (c?.userToken ?? b?.userToken)
            : b?.userToken,
        } as ChannelsConfig["slack"];
      }

      if (body.whatsapp !== undefined) {
        patch.whatsapp = {
          ...current.whatsapp,
          ...body.whatsapp,
        } as ChannelsConfig["whatsapp"];
      }

      updateChannelsConfig(patch);

      const channelScopes: ReloadScope[] = [];
      if (body.slack !== undefined) channelScopes.push("slack");
      if (body.whatsapp !== undefined) channelScopes.push("whatsapp");

      if (channelScopes.length) {
        await setReloadFlags(channelScopes);
      }
    },

    async getWhatsAppConnection() {
      if (!getRedis()) {
        return { status: "disconnected" };
      }
      try {
        const result = (await requestResponse(
          WHATSAPP_CONNECTION_REQUEST_CHANNEL,
          WHATSAPP_CONNECTION_RESPONSE_CHANNEL,
          "get_connection_status",
          {},
          WHATSAPP_CONNECTION_RPC_TIMEOUT_MS,
        )) as WhatsAppConnection;
        return result;
      } catch {
        return { status: "disconnected" };
      }
    },
  };
}
