// Scenarios 19.1 - 19.4: the prompt an agent starts with. No build pass, chat or sample launcher
// exists in this checkout, so each test reads the arguments that werk computes for that agent role
// (agentArgs) from the folded map of a fresh project.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentArgs, INSTRUCTIONS, werkCommand } from "../src/agent/prompt.ts";
import { readMap } from "../src/map/store.ts";
import { freshProject, logOf, real, seed } from "./helpers.ts";

const WERK_ROOT = join(import.meta.dir, "..");
const WERK = werkCommand(process.execPath, join(WERK_ROOT, "src", "cli.ts"));
const BASE = "You are the build agent. Build the ticket you are given.";
const RULES = ["Tests run under one runner", "Every module is small", "Every change passes lint"];

function mapWithRules(count: number) {
  const p = freshProject();
  seed(p, [
    real("how", "How this project is built", { status: "decided", who: "me" }),
    ...RULES.slice(0, count).map((title, i) => real(`rule-${i + 1}`, title, { status: "decided", who: "me", parent: "how" })),
  ]);
  return readMap("test", logOf(p));
}

/** The card ids that werk's own code points at (`#card-id` in comments): ids of werk's own map. */
function werkOwnIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        for (const m of readFileSync(path, "utf8").matchAll(/\(#([a-z][a-z0-9-]+)[,)]/g)) ids.add(m[1] as string);
      }
    }
  };
  walk(join(WERK_ROOT, "src"));
  return ids;
}

const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const agentsOf = (args: string[]) =>
  args.includes("--agents") ? (JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>) : undefined;

test("19.1 a build pass in another project starts with its own prompt, the werk instructions, then the rule titles", () => {
  const map = mapWithRules(3);
  const args = agentArgs({ role: "builder", base: BASE, werk: WERK, map, projectInstructions: "# Other project\n" });
  const prompt = promptOf(args);
  expect(prompt.startsWith(BASE)).toBe(true);
  const filled = INSTRUCTIONS.replaceAll("{{werk}}", WERK).trimEnd();
  const at = prompt.indexOf(filled);
  expect(at).toBeGreaterThan(BASE.length - 1);
  expect(filled).toContain(WERK_ROOT);
  const own = werkOwnIds();
  expect(own.size).toBeGreaterThan(10);
  const named = [...filled.matchAll(/#([a-z][a-z0-9-]+)/g)].map((m) => m[1] as string).filter((id) => own.has(id));
  expect(named).toEqual([]);
  for (const title of RULES) expect(prompt.indexOf(title)).toBeGreaterThan(at + filled.length - 1);
  const agents = agentsOf(args);
  expect(agents).toBeDefined();
  expect(Object.keys(agents ?? {}).sort()).toEqual(["prototyper", "test-scope"]);
  for (const agent of Object.values(agents ?? {})) expect(agent.prompt).toContain(WERK_ROOT);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", () => {
  const map = mapWithRules(3);
  const chat = promptOf(agentArgs({ role: "chat", base: "You are the chat agent.", werk: WERK, map }));
  const filled = INSTRUCTIONS.replaceAll("{{werk}}", WERK).trimEnd();
  expect(chat).toContain(filled);
  for (const title of RULES) expect(chat).toContain(title);
  const sample = promptOf(agentArgs({ role: "sample", base: "You are the sample agent.", werk: WERK, map }));
  expect(sample).not.toContain(filled.slice(0, 200));
  for (const title of RULES) expect(sample).not.toContain(title);
});

test("19.3 a project with no build rules gets no title list", () => {
  const map = mapWithRules(0);
  const prompt = promptOf(agentArgs({ role: "builder", base: BASE, werk: WERK, map }));
  expect(prompt).toContain(INSTRUCTIONS.replaceAll("{{werk}}", WERK).trimEnd());
  expect(prompt).not.toContain("build rules");
  expect(prompt).not.toMatch(/^- #/m);
});

test("19.4 in werk's own checkout the instructions appear one time", () => {
  const agents = readFileSync(join(WERK_ROOT, "AGENTS.md"), "utf8");
  expect(agents).toContain("@src/agent/instructions.md");
  const map = mapWithRules(3);
  const prompt = promptOf(agentArgs({ role: "builder", base: BASE, werk: WERK, map, projectInstructions: agents }));
  // Claude Code loads AGENTS.md (with its include) itself; the appended prompt must not add a second copy.
  const head = INSTRUCTIONS.split("\n").slice(0, 3).join("\n");
  const copies = prompt.split(head).length - 1;
  const fromInclude = agents.split("\n").filter((line) => line.trim() === "@src/agent/instructions.md").length;
  expect(copies + fromInclude).toBe(1);
  for (const title of RULES) expect(prompt).toContain(title);
});
