import type { IntegrationCapability } from "../types/index.js";

/**
 * MCP client layer: connects to MCP servers (Slack, Email, GitHub, etc.)
 * and exposes capabilities. Hooman never talks to integrations directly;
 * Colleagues execute through this layer using granted capabilities.
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
}

export interface MCPToolCall {
  serverId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export class MCPClientLayer {
  private granted: IntegrationCapability[] = [];
  private servers: Map<string, MCPServerConfig> = new Map();

  grantCapability(integrationId: string, capability: string): void {
    if (
      !this.granted.some(
        (c) => c.integrationId === integrationId && c.capability === capability,
      )
    ) {
      this.granted.push({
        integrationId,
        capability,
        granted: true,
        grantedAt: new Date().toISOString(),
      });
    }
  }

  revokeCapability(integrationId: string, capability: string): void {
    this.granted = this.granted.filter(
      (c) =>
        !(c.integrationId === integrationId && c.capability === capability),
    );
  }

  hasCapability(integrationId: string, capability: string): boolean {
    return this.granted.some(
      (c) =>
        c.integrationId === integrationId &&
        c.capability === capability &&
        c.granted,
    );
  }

  listGranted(): IntegrationCapability[] {
    return [...this.granted];
  }

  registerServer(config: MCPServerConfig): void {
    this.servers.set(config.id, config);
  }

  async callTool(call: MCPToolCall): Promise<unknown> {
    if (!this.hasCapability(call.serverId, call.toolName)) {
      throw new Error(
        `Capability not granted: ${call.serverId}/${call.toolName}`,
      );
    }
    // Stub: real implementation would connect to MCP server via stdio/SSE
    return { ok: true, message: "MCP call stub" };
  }
}
