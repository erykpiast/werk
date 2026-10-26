// Held-out steps 19.1 to 19.4: the prompt of an agent that werk starts in a project. The person
// starts a build pass, a chat or a sample; the test first looks for that path, then probes the
// prompt that werk would give, as a diagnostic.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const REPO = join(import.meta.dir, "..");

function seed(p: Project, list: object[]): void {
  appendFileSync(
    join(p.dir, ".werk", "log.jsonl"),
    list.map((e, i) => `${JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}
const decided = (id: string, title: string, parent?: string) => ({
  type: "node.added",
  payload: { id, kind: "card", title, status: "decided", ...(parent ? { parent } : {}) },
});

async function verbs(p: Project): Promise<string> {
  return (await p.werk(["help"])).out;
}

test("19.1 path: the person can start a build pass on a ticket", async () => {
  const p = freshProject();
  expect(await verbs(p)).toMatch(/^ {2}(build|pass|run)\b/m);
});

test("19.2 path: the person can chat and sample options", async () => {
  const p = freshProject();
  const help = await verbs(p);
  expect(help).toMatch(/^ {2}chat\b/m);
  expect(help).toMatch(/^ {2}sample\b/m);
});

// Diagnostics: the prompt that the launcher module gives each role.

const BASE = "You are the build agent. Build the ticket.";
const prompt = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;

test("19.1 probe", () => {
  const p = freshProject();
  seed(p, [
    decided("how", "How"),
    decided("r1", "Rule one", "how"),
    decided("r2", "Rule two", "how"),
    decided("r3", "Rule three", "how"),
  ]);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, "/opt/werk/werk");
  const text = prompt(args);
  expect(text.startsWith(BASE)).toBe(true);
  const instructions = readFileSync(join(REPO, "src", "agent", "instructions.md"), "utf8").split("\n")[0] as string;
  expect(text.indexOf(instructions)).toBeGreaterThan(BASE.length - 1);
  expect(text).toContain("/opt/werk/werk");
  expect(text).not.toContain("{{werk}}");
  expect(text).not.toMatch(/#werk-[a-z]/);
  for (const t of ["Rule one", "Rule two", "Rule three"])
    expect(text.indexOf(t)).toBeGreaterThan(text.indexOf(instructions));
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect(a.prompt).toContain("/opt/werk/werk");
});

test("19.2 probe", () => {
  const p = freshProject();
  seed(p, [decided("how", "How"), decided("r1", "Rule one", "how")]);
  const chat = prompt(projectAgentArgs({ role: "chat", base: "chat", project: p.dir }, "w"));
  const sample = prompt(projectAgentArgs({ role: "sample", base: "sample", project: p.dir }, "w"));
  expect(chat).toContain("decision map");
  expect(chat).toContain("Rule one");
  expect(sample).not.toContain("decision map");
  expect(sample).not.toContain("Rule one");
});

test("19.3 probe", () => {
  const p = freshProject();
  seed(p, [decided("how", "How")]);
  const text = prompt(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, "w"));
  expect(text).toContain("decision map");
  expect(text).not.toContain("build rules");
});

test("19.4 probe", () => {
  const p = freshProject();
  writeFileSync(join(p.dir, "AGENTS.md"), readFileSync(join(REPO, "AGENTS.md"), "utf8"));
  seed(p, [decided("how", "How"), decided("r1", "Rule one", "how")]);
  const text = prompt(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, "w"));
  // Claude Code expands the @ include of AGENTS.md; the prompt must not add a second copy.
  expect(text).not.toContain("# werk — how to work with the decision map");
  expect(text).toContain("Rule one");
});
