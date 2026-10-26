// Held-out steps 19.1 to 19.4: the prompts of the agents that werk starts. The fake agent on PATH
// records each launch with its arguments.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type P, project } from "./helpers.ts";
import { ROOT } from "./repo-copy.ts";

const INSTRUCTIONS = readFileSync(join(ROOT, "src", "agent", "instructions.md"), "utf8");
const FIRST_LINE = INSTRUCTIONS.split("\n")[0] as string;

function withRules(p: P, rules: number): void {
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("how", "How the project is built", { status: "decided", parent: "root" }),
  );
  for (let i = 1; i <= rules; i++)
    p.seed(card(`rule-${i}`, `Build rule number ${i}`, { status: "decided", parent: "how" }));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  writeFileSync(
    join(p.dir, "tickets", "01-first.md"),
    "title: First ticket\ncites: root\nblocked_by:\nstories: 1\ntouches: map\n\n## What to build\n\nA thing.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n",
  );
  p.script({ roles: { builder: { replies: [[{ text: "done" }]] } } } as never);
}

/** Starts a build pass on the first ticket and returns the system prompt of the agent it launched. */
async function buildPrompt(p: P): Promise<string> {
  const run = await p.werk(["build", "tickets/01-first.md"]);
  if (run.code !== 0) throw new Error(`no build pass starts: werk build exited ${run.code}: ${run.err.trim()}`);
  const launch = p.launches().at(0);
  if (launch === undefined) throw new Error("the build pass started no agent");
  return launch.args.join("\n");
}

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the build-rule titles", async () => {
  const p = project();
  withRules(p, 3);
  const prompt = await buildPrompt(p);
  expect(prompt).toContain(FIRST_LINE);
  for (let i = 1; i <= 3; i++) expect(prompt).toContain(`Build rule number ${i}`);
  expect(prompt).toContain("test-scope");
  expect(prompt).toContain("prototyper");
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = project();
  withRules(p, 2);
  const chat = await p.werk(["chat", "What is open?"]);
  const sample = await p.werk(["sample", "rule-1"]);
  expect(chat.code).toBe(0);
  expect(sample.code).toBe(0);
  const launches = p.launches();
  const chatArgs = launches.find((l) => l.role === "chat")?.args.join("\n") ?? "";
  const sampleArgs = launches.find((l) => l.role === "sample")?.args.join("\n") ?? "";
  expect(chatArgs).toContain(FIRST_LINE);
  expect(chatArgs).toContain("Build rule number 1");
  expect(sampleArgs).not.toContain(FIRST_LINE);
  expect(sampleArgs).not.toContain("Build rule number 1");
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = project();
  withRules(p, 0);
  const prompt = await buildPrompt(p);
  expect(prompt).toContain(FIRST_LINE);
  expect(prompt).not.toContain("Build rule number");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = project();
  withRules(p, 2);
  writeFileSync(join(p.dir, "AGENTS.md"), readFileSync(join(ROOT, "AGENTS.md"), "utf8"));
  const prompt = await buildPrompt(p);
  expect(prompt.split(FIRST_LINE).length - 1).toBe(1);
  expect(prompt.indexOf("Build rule number 1")).toBeGreaterThan(prompt.indexOf(FIRST_LINE));
});
