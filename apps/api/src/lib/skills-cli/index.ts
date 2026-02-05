import { spawn } from "child_process";
import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root (apps/api/src/lib/skills-cli -> 5 levels up). Skills CLI runs from here so .agents is at project root. */
const PROJECT_ROOT = join(__dirname, "..", "..", "..", "..", "..");

/** Default agent for skills (user requested "amp"). */
const SKILLS_AGENT = "amp";

/** Global skills dir: CLI installs to ~/.agents/skills/<skill-name> */
const GLOBAL_SKILLS_DIR = join(homedir(), ".agents", "skills");

export interface SkillEntry {
  id: string;
  name: string;
  description?: string;
}

export interface SkillsRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const SKILL_MD = "SKILL.md";

/**
 * Parse name and description from a SKILL.md file's YAML frontmatter.
 */
function parseSkillFrontmatter(
  content: string,
  dirName: string,
): { name: string; description?: string } {
  try {
    const { data } = matter(content);
    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : dirName;
    const description =
      typeof data?.description === "string" && data.description.trim()
        ? data.description.trim()
        : undefined;
    return { name, description };
  } catch {
    return { name: dirName };
  }
}

/**
 * List installed skills by reading ~/.agents/skills and parsing each skill's SKILL.md frontmatter (name, description).
 * Matches where the skills CLI installs (e.g. ~/.agents/skills/pptx).
 */
export async function listSkillsFromFs(): Promise<SkillEntry[]> {
  try {
    const entries = await readdir(GLOBAL_SKILLS_DIR, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    const results: SkillEntry[] = [];
    for (const id of dirs) {
      const skillPath = join(GLOBAL_SKILLS_DIR, id, SKILL_MD);
      try {
        const raw = await readFile(skillPath, "utf-8");
        const { name, description } = parseSkillFrontmatter(raw, id);
        results.push({ id, name, description });
      } catch {
        results.push({ id, name: id });
      }
    }
    return results;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

/** Safe skill id for path (no path traversal). */
function isSafeSkillId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(id) && id.length > 0 && id.length <= 200;
}

/**
 * Read SKILL.md content for a skill by id, with frontmatter (name/description) stripped for display.
 * Returns null if not found or invalid id.
 */
export async function getSkillContent(skillId: string): Promise<string | null> {
  if (!isSafeSkillId(skillId)) return null;
  try {
    const path = join(GLOBAL_SKILLS_DIR, skillId, SKILL_MD);
    const raw = await readFile(path, "utf-8");
    const { content } = matter(raw);
    return typeof content === "string" ? content.trim() : "";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Run npx skills with args. Uses project root as cwd (or SKILLS_CWD env).
 * Does not persist to DB; CLI manages .agents / ~/.agents.
 */
export async function runSkills(
  args: string[],
  options?: { cwd?: string },
): Promise<SkillsRunResult> {
  const cwd =
    (typeof process.env.SKILLS_CWD === "string" &&
      process.env.SKILLS_CWD.trim()) ||
    options?.cwd ||
    PROJECT_ROOT;

  return new Promise((resolve) => {
    const proc = spawn("npx", ["skills", ...args], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? null });
    });
    proc.on("error", (err) => {
      stderr += (err as Error).message;
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

/** Add a skill package. global => --global, skills => --skill x --skill y, -y non-interactive */
export async function addSkill(options: {
  package: string;
  global?: boolean;
  skills?: string[];
}): Promise<SkillsRunResult> {
  const args = ["add", options.package.trim(), "-a", SKILLS_AGENT, "--yes"];
  if (options.global) args.push("--global");
  for (const s of options.skills ?? []) {
    const t = String(s).trim();
    if (t) args.push("--skill", t);
  }
  return runSkills(args);
}

/** Remove installed skills by name. */
export async function removeSkills(
  skillNames: string[],
  global = false,
): Promise<SkillsRunResult> {
  if (skillNames.length === 0) {
    return { stdout: "", stderr: "No skills specified.", code: 1 };
  }
  const args = ["remove", ...skillNames.map((s) => s.trim()).filter(Boolean)];
  if (global) args.push("--global");
  args.push("-a", SKILLS_AGENT);
  return runSkills(args);
}
