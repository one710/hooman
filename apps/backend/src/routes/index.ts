import type { Express } from "express";
import type { AppContext } from "./helpers.js";
import { registerInternalRoutes } from "./internal.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerChatRoutes } from "./chat.js";
import { registerCompletionsRoutes } from "./completions.js";
import { registerPersonaRoutes } from "./personas.js";
import { registerAuditRoutes } from "./audit.js";
import { registerChannelRoutes } from "./channels.js";
import { registerCapabilityRoutes } from "./capabilities.js";
import { registerScheduleRoutes } from "./schedule.js";

export type { AppContext };

export function registerRoutes(app: Express, ctx: AppContext): void {
  registerInternalRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerCompletionsRoutes(app, ctx);
  registerPersonaRoutes(app, ctx);
  registerAuditRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerCapabilityRoutes(app, ctx);
  registerScheduleRoutes(app, ctx);
}
