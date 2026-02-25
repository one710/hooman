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
      cwd: env.MCP_STDIO_DEFAULT_CWD,
    },
    {
      id: "_default_time",
      type: "stdio",
      name: "time",
      command: "uvx",
      args: ["mcp-server-time"],
      cwd: env.MCP_STDIO_DEFAULT_CWD,
    },
    {
      id: "_default_desktop_commander",
      type: "stdio",
      name: "desktop_commander",
      command: "docker",
      args: [
        "run",
        "--rm",
        "-i",
        "-v",
        `${env.MCP_STDIO_DEFAULT_CWD}:/mcpcwd`,
        "-w",
        "/mcpcwd",
        "mcp/desktop-commander:latest",
        "node",
        "/usr/src/app/dist/index.js",
      ],
      tool_filter:
        "!get_config,!set_config_value,!get_usage_stats,!get_recent_tool_calls,!give_feedback_to_desktop_commander",
    },
    {
      id: "_default_memory",
      type: "stdio",
      name: "memory",
      command: "npx",
      args: ["tsx", MEMORY_MCP_SERVER_PATH],
      env: { CHROMA_URL: env.CHROMA_URL },
      cwd: env.MCP_STDIO_DEFAULT_CWD,
    },
    {
      id: "_default_schedule",
      type: "stdio",
      name: "schedule",
      command: "npx",
      args: ["tsx", SCHEDULE_MCP_SERVER_PATH],
      env: { REDIS_URL: env.REDIS_URL ?? "" },
      cwd: env.MCP_STDIO_DEFAULT_CWD,
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
      cwd: env.MCP_STDIO_DEFAULT_CWD,
    });
  }
  return out;
}

export function getAllDefaultMcpConnections(): MCPConnection[] {
  return [...getDefaultMcpConnections(), ...getChannelDefaultMcpConnections()];
}
