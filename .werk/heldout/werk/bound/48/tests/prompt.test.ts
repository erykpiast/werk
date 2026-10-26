// Held-out steps 19.1–19.4. No command in this checkout starts a build pass, a chat agent or a
// sample agent, so each step reads the start-up arguments that werk builds for that agent.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { agentArgs, fillWerk, INSTRUCTIONS, type AgentRole, werkCommand } from "../repo/src/agent/prompt.ts";
import { fold } from "../repo/src/map/fold.ts";

const WERK_DIR = join(import.meta.dir, "..", "repo");
const WERK = werkCommand(process.execPath, join(WERK_DIR, "src", "cli.ts"));
const BASE = "You are the build agent. Build the ticket you are given, then stop.\n";

function mapWith(children: string[]) {
  const events = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Shop" } },
    { type: "node.added", payload: { id: "how", kind: "card", title: "How the shop is built" } },
    ...children.flatMap((title, i) => [
      { type: "node.added", payload: { id: `rule-${i}`, kind: "card", title, parent: "how" } },
      { type: "node.decided", payload: { id: `rule-${i}` } },
    ]),
  ];
  return fold(`${events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`);
}
const RULES = ["Prices are integers in cents", "Every page loads in under one second", "Orders never get deleted"];

function start(role: AgentRole, children: string[], projectInstructions?: string) {
  const args = agentArgs({ role, base: BASE, werk: WERK, map: mapWith(children), projectInstructions });
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  const at = args.indexOf("--agents");
  const agents = at === -1 ? undefined : (JSON.parse(args[at + 1] as string) as Record<string, { prompt: string; description: string }>);
  return { prompt, agents };
}
const FILLED = fillWerk(INSTRUCTIONS, WERK).trimEnd();

test("19.1", () => {
  const { prompt, agents } = start("builder", RULES, "# Shop\n\nRun `npm test`.\n");
  expect(prompt.startsWith(BASE.trimEnd())).toBe(true);
  const at = prompt.indexOf(FILLED);
  expect(at).toBeGreaterThan(0);
  expect(prompt.slice(BASE.trimEnd().length, at).trim()).toBe("");
  expect(FILLED).toContain(WERK_DIR);
  expect(FILLED).not.toContain("{{werk}}");
  expect(FILLED).not.toMatch(/#(werk|st|pr|al|lp|map|vi)-[a-z0-9-]+/);
  for (const title of RULES) expect(prompt.indexOf(title)).toBeGreaterThan(at + FILLED.length - 1);
  expect(agents).toBeDefined();
  expect(Object.keys(agents ?? {}).sort()).toEqual(["prototyper", "test-scope"]);
  expect(agents?.["test-scope"]?.prompt).toContain(WERK_DIR);
  expect(agents?.prototyper?.prompt).toContain(WERK_DIR);
});

test("19.2", () => {
  const chat = start("chat", RULES).prompt;
  expect(chat).toContain(FILLED);
  for (const title of RULES) expect(chat).toContain(title);
  const sample = start("sample", RULES);
  expect(sample.prompt).not.toContain(FILLED.slice(0, 200));
  expect(sample.prompt).not.toContain("decision map");
  for (const title of RULES) expect(sample.prompt).not.toContain(title);
  expect(sample.prompt).not.toContain("build rules");
});

test("19.3", () => {
  const { prompt } = start("builder", []);
  expect(prompt).toContain(FILLED);
  expect(prompt).not.toContain("build rules");
  expect(prompt).not.toMatch(/^- #/m);
});

test("19.4", async () => {
  // werk's own checkout: AGENTS.md includes the shipped text, and the agent reads AGENTS.md itself.
  const agentsMd = await Bun.file(join(WERK_DIR, "AGENTS.md")).text();
  expect(agentsMd).toContain("@src/agent/instructions.md");
  const { prompt } = start("builder", RULES, agentsMd);
  const firstLine = INSTRUCTIONS.split("\n")[0] as string;
  const inProject = agentsMd.includes("@src/agent/instructions.md") ? 1 : 0;
  const inPrompt = prompt.split(firstLine).length - 1;
  expect(inProject + inPrompt).toBe(1);
  for (const title of RULES) expect(prompt).toContain(title);
});
