import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { card, decided, ok, withMap } from "./helpers.ts";

const WERK_ROOT = dirname(import.meta.dir);
const INSTRUCTIONS = readFileSync(join(WERK_ROOT, "src/agent/instructions.md"), "utf8");

/** The way a person starts a build pass on a ticket: a werk verb or a server route. */
async function buildEntry(): Promise<string | undefined> {
  const p = withMap([]);
  const help = (await ok(p, ["help"])).out;
  const verb = help.split("\n").find((l) => /^ {2}(build|pass|run-ticket|chat|sample)(\s|$)/.test(l));
  return verb;
}

const rules = (extra: Parameters<typeof withMap>[0] = []) =>
  withMap([
    card("how", "How this project is built"),
    card("rule-a", "Tests run under one runner", "how"),
    card("rule-b", "Each module is small", "how"),
    card("rule-c", "Lint runs before merge", "how"),
    decided("how"),
    decided("rule-a"),
    decided("rule-b"),
    decided("rule-c"),
    ...extra,
  ]);

// The step's When: the person starts a build pass. The product has to offer a way to start one.
for (const id of ["19.1", "19.2", "19.3", "19.4"]) {
  test(`${id} entry: a person can start the agent`, async () => {
    expect(await buildEntry()).toBeDefined();
  });
}

// What the prompt assembly gives, read at the module seam, to explain the result.
test("19.1 prompt", () => {
  const p = rules();
  const werk = `${process.execPath} ${join(WERK_ROOT, "src/cli.ts")}`;
  const args = projectAgentArgs({ role: "builder", base: "BUILD AGENT PROMPT", project: p.dir }, werk);
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(prompt.startsWith("BUILD AGENT PROMPT\n")).toBe(true);
  const filled = INSTRUCTIONS.replaceAll("{{werk}}", werk).trimEnd();
  expect(prompt.indexOf(filled)).toBeGreaterThan(0);
  expect(prompt).toContain(`${werk} add`);
  expect(filled).not.toMatch(/#werk-[a-z]/);
  const titles = ["Tests run under one runner", "Each module is small", "Lint runs before merge"].map((t) => prompt.indexOf(t));
  for (const at of titles) expect(at).toBeGreaterThan(prompt.indexOf(filled) + filled.length - 1);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents) as { prompt: string }[]) expect(a.prompt).toContain(WERK_ROOT);
});

test("19.2 prompt", () => {
  const p = rules();
  const chat = projectAgentArgs({ role: "chat", base: "CHAT", project: p.dir }, "werkcmd");
  const sample = projectAgentArgs({ role: "sample", base: "SAMPLE", project: p.dir }, "werkcmd");
  const chatPrompt = chat[1] as string;
  const samplePrompt = sample[1] as string;
  expect(chatPrompt).toContain(INSTRUCTIONS.replaceAll("{{werk}}", "werkcmd").trimEnd());
  expect(chatPrompt).toContain("Tests run under one runner");
  expect(samplePrompt).not.toContain("decision map");
  expect(samplePrompt).not.toContain("Tests run under one runner");
});

test("19.3 prompt", () => {
  const p = withMap([card("how", "How this project is built"), decided("how")]);
  const prompt = projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "werkcmd")[1] as string;
  expect(prompt).toContain(INSTRUCTIONS.replaceAll("{{werk}}", "werkcmd").trimEnd());
  expect(prompt).not.toContain("build rules");
});

test("19.4 prompt", () => {
  const p = rules();
  writeFileSync(join(p.dir, "AGENTS.md"), readFileSync(join(WERK_ROOT, "AGENTS.md"), "utf8"));
  const prompt = projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "werkcmd")[1] as string;
  // The project's AGENTS.md is what includes the text in werk's checkout; werk adds no second copy.
  expect(prompt).not.toContain("# werk — how to work with the decision map");
  expect(prompt).toContain("Tests run under one runner");
});
