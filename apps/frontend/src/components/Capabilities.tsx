import { useState, useRef } from "react";
import { Plus } from "lucide-react";
import { Tools } from "./Tools";
import { McpConnections } from "./McpConnections";
import type { McpConnectionsHandle } from "./McpConnections";
import { Skills } from "./Skills";
import type { SkillsHandle } from "./Skills";
import { Button } from "./Button";
import { PageHeader } from "./PageHeader";

type CapabilityTab = "tools" | "mcp" | "skills";

export function Capabilities() {
  const [activeTab, setActiveTab] = useState<CapabilityTab>("tools");
  const mcpRef = useRef<McpConnectionsHandle>(null);
  const skillsRef = useRef<SkillsHandle>(null);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Capabilities"
        subtitle="Connect tools and services so Hooman can act on your behalf."
      >
        {activeTab === "mcp" && (
          <Button
            onClick={() => mcpRef.current?.startAdd()}
            icon={<Plus className="w-4 h-4" />}
            className="shrink-0"
          >
            Add MCP server
          </Button>
        )}
        {activeTab === "skills" && (
          <Button
            onClick={() => skillsRef.current?.startAdd()}
            icon={<Plus className="w-4 h-4" />}
            className="shrink-0"
          >
            Add skill
          </Button>
        )}
      </PageHeader>
      <div className="px-4 md:px-6 pt-3 shrink-0">
        <div className="flex gap-1 border-b border-hooman-border -mb-px">
          {(
            [
              { id: "tools", label: "Tools" },
              { id: "mcp", label: "MCP servers" },
              { id: "skills", label: "Skills" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-hooman-accent text-white bg-hooman-surface"
                  : "border-transparent text-hooman-muted hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {activeTab === "tools" && <Tools />}
        {activeTab === "mcp" && <McpConnections ref={mcpRef} />}
        {activeTab === "skills" && <Skills ref={skillsRef} />}
      </div>
    </div>
  );
}
