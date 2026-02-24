import { join } from "path";
import { BACKEND_ROOT, env } from "../../env.js";
import { getChannelsConfig } from "../../config.js";
import type { MCPConnection, MCPConnectionStdio } from "../../types.js";

const MEMORY_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "memory-mcp-server.ts",
);

const SCHEDULE_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "schedule-mcp-server.ts",
);

const WHATSAPP_MCP_SERVER_PATH = join(
  BACKEND_ROOT,
  "src",
  "capabilities",
  "mcp",
  "whatsapp-mcp-server.ts",
);

export function getDefaultMcpConnections(): MCPConnectionStdio[] {
  return [
    {
      id: "_default_fetch",
      type: "stdio",
      name: "fetch",
      command: "uvx",
      args: ["mcp-server-fetch"],
    },
    {
      id: "_default_time",
      type: "stdio",
      name: "time",
      command: "uvx",
      args: ["mcp-server-time"],
    },
    {
      id: "_default_desktop_commander",
      type: "stdio",
      name: "desktop_commander",
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
    },
    {
      id: "_default_memory",
      type: "stdio",
      name: "memory",
      command: "npx",
      args: ["tsx", MEMORY_MCP_SERVER_PATH],
      env: { CHROMA_URL: env.CHROMA_URL },
    },
    {
      id: "_default_schedule",
      type: "stdio",
      name: "schedule",
      command: "npx",
      args: ["tsx", SCHEDULE_MCP_SERVER_PATH],
      env: { REDIS_URL: env.REDIS_URL ?? "" },
    },
  ];
}

export function getChannelDefaultMcpConnections(): MCPConnectionStdio[] {
  const channels = getChannelsConfig();
  const out: MCPConnectionStdio[] = [];
  if (channels.whatsapp?.enabled && env.REDIS_URL) {
    out.push({
      id: "_default_whatsapp",
      type: "stdio",
      name: "whatsapp",
      command: "npx",
      args: ["tsx", WHATSAPP_MCP_SERVER_PATH],
      env: { REDIS_URL: env.REDIS_URL },
    });
  }
  return out;
}

export function getAllDefaultMcpConnections(): MCPConnection[] {
  return [...getDefaultMcpConnections(), ...getChannelDefaultMcpConnections()];
}
