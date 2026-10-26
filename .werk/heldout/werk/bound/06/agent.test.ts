// Held-out steps 19.1 to 19.4: the prompt a build pass, a chat agent and a sample agent start with.
// Each test records what werk's prompt builder gives, then checks that werk can start the agent.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUCTIONS, subagentsFor, systemPrompt, werkCommand } from "../src/agent/prompt.ts";
import { fold } from "../src/map/fold.ts";
import { ROOT } from "./helpers.ts";

const WERK = werkCommand(process.execPath, join(ROOT, "src/cli.ts"));
const BASE = "You are the build agent. Build the ticket.";

const card = (id: string, title: string, parent?: string) => ({
  type: "node.added",
  actor: "you",
  payload: { id, kind: "card", title, status: "decided", ...(parent ? { parent } : {}) },
});
const mapOf = (...events: ReturnType<typeof card>[]) =>
  fold(events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", ...e })).join("\n"));

const RULES = mapOf(
  card("how", "Build rules"),
  card("rule-db", "Tests run against a real database", "how"),
  card("rule-fast", "A unit test takes under a second", "how"),
  card("rule-words", "An order is one checkout", "how"),
);

/** The verbs of werk's command line. */
function verbs(): string[] {
  const out = Bun.spawnSync([process.execPath, join(ROOT, "src/cli.ts"), "help"], { stdout: "pipe" }).stdout.toString();
  return [...out.matchAll(/^ {2}([a-z-]+)/gm)].map((m) => m[1] as string);
}
const startsAgent = (...names: string[]) => verbs().some((verb) => names.includes(verb));

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the build-rule titles", () => {
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map: RULES });
  expect(prompt.startsWith(BASE)).toBe(true);
  const at = prompt.indexOf("# werk — how to work with the decision map");
  expect(at).toBeGreaterThan(BASE.length - 1);
  expect(prompt).toContain(WERK);
  expect(prompt).not.toContain("{{werk}}");
  const instructions = prompt.slice(at, prompt.indexOf("## This project's build rules"));
  expect(instructions).not.toMatch(/#werk-[a-z]/);
  const rules = prompt.indexOf("## This project's build rules");
  expect(rules).toBeGreaterThan(at);
  for (const t of ["Tests run against a real database", "A unit test takes under a second", "An order is one checkout"])
    expect(prompt.indexOf(t)).toBeGreaterThan(rules);
  const subagents = subagentsFor({ role: "builder", base: BASE, werk: WERK, map: RULES }) ?? {};
  expect(Object.keys(subagents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const s of Object.values(subagents)) expect(s.prompt).toContain(WERK);
  // The person starts a build pass on a ticket and opens its prompt.
  expect(startsAgent("build", "ticket", "board"), "werk can start a build pass on a ticket").toBe(true);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", () => {
  const chat = systemPrompt({ role: "chat", base: "You chat.", werk: WERK, map: RULES });
  expect(chat).toContain("# werk — how to work with the decision map");
  expect(chat).toContain("Tests run against a real database");
  const sample = systemPrompt({ role: "sample", base: "You sample options.", werk: WERK, map: RULES });
  expect(sample).not.toContain("# werk — how to work with the decision map");
  expect(sample, "the sample agent holds no list of build-rule titles").not.toContain(
    "Tests run against a real database",
  );
  expect(startsAgent("chat", "sample", "serve"), "werk can start a chat agent and a sample agent").toBe(true);
});

test("19.3 a project with no build rules gets no title list", () => {
  const map = mapOf(card("how", "Build rules"));
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map });
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).not.toContain("## This project's build rules");
  expect(startsAgent("build", "ticket", "board"), "werk can start a build pass on a ticket").toBe(true);
});

test("19.4 in werk's own checkout the instructions appear one time", () => {
  const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  // The build pass reads the project's AGENTS.md; Claude Code expands its @ include.
  const expanded = agentsMd.replace("@src/agent/instructions.md", INSTRUCTIONS);
  const prompt = systemPrompt({ role: "builder", base: BASE, werk: WERK, map: RULES, projectInstructions: agentsMd });
  const whole = `${expanded}\n${prompt}`;
  expect(whole.split("# werk — how to work with the decision map").length - 1).toBe(1);
  expect(prompt).toContain("## This project's build rules");
  expect(startsAgent("build", "ticket", "board"), "werk can start a build pass on a ticket").toBe(true);
});
