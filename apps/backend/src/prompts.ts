import { readFile } from "fs/promises";
import { join } from "path";
import createDebug from "debug";
import { BACKEND_ROOT } from "./env.js";
import type { ChannelsConfig } from "./types.js";

const debug = createDebug("hooman:prompts");

const PROMPTS_DIR = join(BACKEND_ROOT, "prompts");

interface PromptCache {
  defaultAgentInstructions?: string;
  staticAppend?: string;
  channelSlack?: string;
  channelWhatsapp?: string;
}

const cache: PromptCache = {};

async function loadOne(
  key: keyof PromptCache,
  filename: string,
): Promise<void> {
  const path = join(PROMPTS_DIR, filename);
  try {
    const content = await readFile(path, "utf-8");
    cache[key] = content;
    debug("loaded prompt %s from %s", key, path);
  } catch (err) {
    debug("prompt file not loaded %s: %o", path, err);
  }
}

/**
 * Load all prompt files from apps/backend/prompts/ into memory.
 * Call once at startup. Files are expected to exist.
 */
export async function loadPrompts(): Promise<void> {
  await Promise.all([
    loadOne("defaultAgentInstructions", "default-agent-instructions.md"),
    loadOne("staticAppend", "static-append.md"),
    loadOne("channelSlack", "channel-slack.md"),
    loadOne("channelWhatsapp", "channel-whatsapp.md"),
  ]);
}

export function getDefaultAgentInstructions(): string {
  return cache.defaultAgentInstructions ?? "";
}

export function getStaticAppend(): string {
  return cache.staticAppend ?? "";
}

export function getChannelSlackInstructions(): string {
  return cache.channelSlack ?? "";
}

export function getChannelWhatsAppInstructions(): string {
  return cache.channelWhatsapp ?? "";
}

/**
 * Full static instructions: base + channel-specific formatting (only for enabled channels).
 * Call with getChannelsConfig() from config to avoid circular dependency.
 */
export function getFullStaticAgentInstructionsAppend(
  channels: ChannelsConfig,
): string {
  let out = getStaticAppend();
  if (channels.slack?.enabled) {
    out += getChannelSlackInstructions();
  }
  if (channels.whatsapp?.enabled) {
    out += getChannelWhatsAppInstructions();
  }
  return out;
}
