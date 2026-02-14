import { getPrisma } from "./db.js";
import type { PersonaConfig } from "../types.js";

export interface PersonaStore {
  getAll(): Promise<PersonaConfig[]>;
  getById(id: string): Promise<PersonaConfig | null>;
  addOrUpdate(persona: PersonaConfig): Promise<void>;
  remove(id: string): Promise<boolean>;
}

function rowToPersona(row: {
  id: string;
  description: string;
  responsibilities: string;
  allowed_connections: string;
  allowed_skills: string;
  memory: string;
  reporting: string;
}): PersonaConfig {
  const parseArr = (s: string): string[] => {
    try {
      const a = JSON.parse(s) as unknown;
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  };
  const parseMemory = (s: string): { scope: "role" | "global" } => {
    try {
      const o = JSON.parse(s) as { scope?: string };
      return o?.scope === "global" ? { scope: "global" } : { scope: "role" };
    } catch {
      return { scope: "role" };
    }
  };
  const parseReporting = (
    s: string,
  ): { on: ("task_complete" | "uncertainty" | "error")[] } => {
    try {
      const o = JSON.parse(s) as { on?: unknown[] };
      const on = Array.isArray(o?.on) ? o.on : ["task_complete", "uncertainty"];
      return {
        on: on.filter((x): x is "task_complete" | "uncertainty" | "error" =>
          ["task_complete", "uncertainty", "error"].includes(String(x)),
        ) as ("task_complete" | "uncertainty" | "error")[],
      };
    } catch {
      return { on: ["task_complete", "uncertainty"] };
    }
  };

  return {
    id: row.id,
    description: row.description ?? "",
    responsibilities: row.responsibilities ?? "",
    allowed_connections: parseArr(row.allowed_connections),
    allowed_skills: parseArr(row.allowed_skills),
    memory: parseMemory(row.memory),
    reporting: parseReporting(row.reporting),
  };
}

export async function initPersonaStore(): Promise<PersonaStore> {
  const prisma = getPrisma();

  return {
    async getAll(): Promise<PersonaConfig[]> {
      const rows = await prisma.persona.findMany({ orderBy: { id: "asc" } });
      return rows.map(rowToPersona);
    },

    async getById(id: string): Promise<PersonaConfig | null> {
      const row = await prisma.persona.findUnique({ where: { id } });
      if (!row) return null;
      return rowToPersona(row);
    },

    async addOrUpdate(persona: PersonaConfig): Promise<void> {
      await prisma.persona.upsert({
        where: { id: persona.id },
        create: {
          id: persona.id,
          description: persona.description ?? "",
          responsibilities: persona.responsibilities ?? "",
          allowed_connections: JSON.stringify(
            persona.allowed_connections ?? [],
          ),
          allowed_skills: JSON.stringify(persona.allowed_skills ?? []),
          memory: JSON.stringify(persona.memory ?? { scope: "role" }),
          reporting: JSON.stringify(
            persona.reporting ?? { on: ["task_complete", "uncertainty"] },
          ),
        },
        update: {
          description: persona.description ?? "",
          responsibilities: persona.responsibilities ?? "",
          allowed_connections: JSON.stringify(
            persona.allowed_connections ?? [],
          ),
          allowed_skills: JSON.stringify(persona.allowed_skills ?? []),
          memory: JSON.stringify(persona.memory ?? { scope: "role" }),
          reporting: JSON.stringify(
            persona.reporting ?? { on: ["task_complete", "uncertainty"] },
          ),
        },
      });
    },

    async remove(id: string): Promise<boolean> {
      const result = await prisma.persona.deleteMany({ where: { id } });
      return (result.count ?? 0) > 0;
    },
  };
}
