import type { Express, Request, Response } from "express";
import type { AppContext } from "./helpers.js";
import { mask, isMasked } from "./helpers.js";
import type { ChannelsConfig } from "../types.js";
import { getChannelsConfig, updateChannelsConfig } from "../config.js";
import { setReloadFlags, type ReloadScope } from "../data/reload-flag.js";
import { getRedis } from "../data/redis.js";
import { requestResponse } from "../data/pubsub.js";
import { env } from "../env.js";

const WHATSAPP_CONNECTION_REQUEST_CHANNEL =
  "hooman:whatsapp:connection:request";
const WHATSAPP_CONNECTION_RESPONSE_CHANNEL =
  "hooman:whatsapp:connection:response";
const WHATSAPP_CONNECTION_RPC_TIMEOUT_MS = 5000;

export function registerChannelRoutes(app: Express, _ctx: AppContext): void {
  app.get("/api/channels", (_req: Request, res: Response) => {
    const channels = getChannelsConfig();
    res.json({
      channels: {
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
      },
    });
  });

  app.patch(
    "/api/channels",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as Partial<ChannelsConfig>;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid body." });
        return;
      }
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
      if (body.whatsapp !== undefined)
        patch.whatsapp = {
          ...current.whatsapp,
          ...body.whatsapp,
        } as ChannelsConfig["whatsapp"];
      updateChannelsConfig(patch);
      const channelScopes: ReloadScope[] = [];
      if (body.slack !== undefined) channelScopes.push("slack");
      if (body.whatsapp !== undefined) channelScopes.push("whatsapp");
      if (channelScopes.length)
        await setReloadFlags(env.REDIS_URL, channelScopes);
      res.json({ channels: getChannelsConfig() });
    },
  );

  app.get(
    "/api/channels/whatsapp/connection",
    async (_req: Request, res: Response) => {
      if (!getRedis()) {
        res.json({ status: "disconnected" });
        return;
      }
      try {
        const result = (await requestResponse(
          WHATSAPP_CONNECTION_REQUEST_CHANNEL,
          WHATSAPP_CONNECTION_RESPONSE_CHANNEL,
          "get_connection_status",
          {},
          WHATSAPP_CONNECTION_RPC_TIMEOUT_MS,
        )) as {
          status: "disconnected" | "pairing" | "connected";
          qr?: string;
          selfId?: string;
          selfNumber?: string;
        };
        res.json(result);
      } catch {
        res.json({ status: "disconnected" });
      }
    },
  );
}
