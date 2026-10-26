// Scenarios 19.1-19.4: the prompt each agent that werk starts gets. The person's path is a build
// pass on a ticket, a chat message, and a sample of options; the fake agent on PATH records each
// launch and its arguments.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, freshProject, type Project, seed } from "./helpers.ts";

function withRules(rules: string[]): Project {
  const p = freshProject();
  seed(p, [
    card("root", "Root"),
    card("how", "How this project is built", "root"),
    decided("how"),
    ...rules.flatMap((title, i) => [card(`rule-${i + 1}`, title, "how"), decided(`rule-${i + 1}`)]),
  ]);
  mkdirSync(join(p.dir, "tickets"));
  writeFileSync(join(p.dir, "tickets", "01-first.md"), "title: First ticket\ncites: root\nblocked_by:\nstories: 1\ntouches: x\n");
  p.script({ roles: { builder: { replies: [[]] }, chat: { replies: [[]] }, sample: { replies: [[]] } } });
  return p;
}

const RULES = ["Tests run under Bun", "Every change passes lint", "Modules stay small"];

async function startBuild(p: Project) {
  return p.werk(["build", "tickets/01-first.md"]);
}

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the build-rule titles", async () => {
  const p = withRules(RULES);
  const run = await startBuild(p);
  expect(run.err).not.toContain("unknown verb");
  expect(run.code).toBe(0);
  const launch = p.launches().find((l) => l.role === "builder");
  expect(launch).toBeDefined();
  const prompt = launch?.args[launch.args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain("werk — how to work with the decision map");
  for (const t of RULES) expect(prompt).toContain(t);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = withRules(RULES);
  const chat = await p.werk(["chat", "Hello"]);
  expect(chat.err).not.toContain("unknown verb");
  const sample = await p.werk(["sample", "rule-1"]);
  expect(sample.err).not.toContain("unknown verb");
  const chatLaunch = p.launches().find((l) => l.role === "chat");
  const sampleLaunch = p.launches().find((l) => l.role === "sample");
  expect(chatLaunch).toBeDefined();
  expect(sampleLaunch).toBeDefined();
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = withRules([]);
  const run = await startBuild(p);
  expect(run.err).not.toContain("unknown verb");
  const launch = p.launches().find((l) => l.role === "builder");
  expect(launch).toBeDefined();
  const prompt = launch?.args.join("\n") ?? "";
  expect(prompt).toContain("werk — how to work with the decision map");
  expect(prompt).not.toContain("build rules");
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = withRules(RULES);
  writeFileSync(join(p.dir, "AGENTS.md"), "# Working on werk\n\n@src/agent/instructions.md\n");
  const run = await startBuild(p);
  expect(run.err).not.toContain("unknown verb");
  const launch = p.launches().find((l) => l.role === "builder");
  expect(launch).toBeDefined();
  const prompt = launch?.args.join("\n") ?? "";
  expect(prompt.split("werk — how to work with the decision map").length - 1).toBeLessThanOrEqual(1);
});
