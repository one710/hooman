/**
 * WhatsApp worker: runs the WhatsApp channel adapter (Baileys v6), posting events to API via POST /api/internal/dispatch.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only whatsapp).
 */
import createDebug from "debug";
import { loadPersisted, getChannelsConfig } from "../lib/core/config.js";
import { createDispatchClient } from "../lib/api/dispatch-client.js";
import {
  startWhatsAppAdapter,
  stopWhatsAppAdapter,
} from "../lib/channels/whatsapp-adapter.js";
import { initRedis, closeRedis } from "../lib/data/redis.js";
import {
  initReloadWatch,
  closeReloadWatch,
} from "../lib/schedule/reload-flag.js";
import { env } from "../env.js";

const debug = createDebug("hooman:workers:whatsapp");

const connectionStatusUrl = () =>
  `${env.API_BASE_URL.replace(/\/$/, "")}/api/internal/whatsapp-connection`;

async function runWhatsAppAdapter(
  client: ReturnType<typeof createDispatchClient>,
): Promise<void> {
  await stopWhatsAppAdapter();
  await startWhatsAppAdapter(client, () => getChannelsConfig().whatsapp, {
    onConnectionUpdate: async ({ status, qr, selfId, selfNumber }) => {
      try {
        const res = await fetch(connectionStatusUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.INTERNAL_SECRET
              ? { "X-Internal-Secret": env.INTERNAL_SECRET }
              : {}),
          },
          body: JSON.stringify({ status, qr, selfId, selfNumber }),
        });
        if (!res.ok) {
          debug(
            "Failed to post connection update to API: %s %s",
            res.status,
            res.statusText,
          );
        } else if (status === "pairing" && qr) {
          debug("QR sent to API for Settings UI");
        } else if (status === "connected") {
          debug(
            "Linked; connection open (self: %s)",
            selfNumber ?? selfId ?? "—",
          );
        }
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { cause?: { code?: string } };
        const refused =
          err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED";
        if (refused) {
          debug(
            "Cannot reach API at %s — is the API process running? QR will not show in Settings until the API is up.",
            connectionStatusUrl(),
          );
        } else {
          debug("Failed to post connection update: %o", e);
        }
      }
    },
  });
}

async function main() {
  await loadPersisted();
  const client = createDispatchClient({
    apiBaseUrl: env.API_BASE_URL,
    secret: env.INTERNAL_SECRET || undefined,
  });
  await runWhatsAppAdapter(client);

  if (env.REDIS_URL) {
    initRedis(env.REDIS_URL);
    initReloadWatch(env.REDIS_URL, ["whatsapp"], async () => {
      debug("Reload flag set; reloading config and restarting adapter");
      await loadPersisted();
      void runWhatsAppAdapter(client);
    });
  }

  debug("Worker started; posting to %s", env.API_BASE_URL);

  const shutdown = async () => {
    debug("Shutting down WhatsApp worker…");
    await closeReloadWatch();
    await stopWhatsAppAdapter();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  debug("WhatsApp worker failed: %o", err);
  process.exit(1);
});
