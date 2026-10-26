import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { startChat, type Chat, type ChatEvent } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { checkSubagentLinks } from "../scripts/subagent-links.ts";
import { freshProject } from "../src/test/project.ts";
import { mapProject } from "./plan-helpers.ts";

let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

const rules = [
  { id: "how" },
  { id: "rule-one", parent: "how" },
  { id: "rule-two", parent: "how" },
  { id: "rule-three", parent: "how" },
];

test("19.1 build pass in another project", async () => {
  const p = mapProject(rules);
  const r = await p.werk(["build", "any/01"]);
  expect(r.err).not.toContain("no verb");
  expect(r.code).toBe(0);
});

test("19.2 chat agent prompt vs sample agent prompt", async () => {
  const p = mapProject(rules);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const result = { event: { type: "result", subtype: "success", result: "ok", session_id: "s" } };
  p.script({ roles: { chat: { replies: [[{ event: { type: "system", subtype: "init", session_id: "s" } }, result]], exit: 0 } } });
  const events: ChatEvent[] = [];
  const log = join(p.dir, ".werk", "log.jsonl");
  chat = startChat(p.dir, log, (e) => events.push(e));
  chat.send({ text: "hello", turn: "t1", card: "root" });
  for (let i = 0; i < 500 && p.launches().length < 1; i++) await Bun.sleep(10);
  const args = p.launches()[0]!.args;
  const sys = args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(sys).toContain("werk — how to work with the decision map");
  for (const t of ["Card rule-one", "Card rule-two", "Card rule-three"]) expect(sys).toContain(t);
  // The sample launcher: no verb or route starts a sample agent, so the prompt is read from the sample role's args.
  const help = await p.werk(["help"]);
  expect(help.out).toMatch(/^\s*sample\b/m);
  const sample = projectAgentArgs({ role: "sample", base: "base", project: p.dir, log });
  expect(sample.join(" ")).not.toContain("how to work with the decision map");
  expect(sample.join(" ")).not.toContain("Card rule-one");
});

test("19.3", async () => {
  const p = mapProject([{ id: "how" }]);
  const r = await p.werk(["build", "any/01"]);
  expect(r.code).toBe(0);
});

test("19.4", async () => {
  const p = mapProject(rules);
  const r = await p.werk(["build", "any/01"]);
  expect(r.code).toBe(0);
});

test("19.5", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-links-"));
  try {
    const checkout = join(import.meta.dir, "..");
    mkdirSync(join(root, "src", "agent"), { recursive: true });
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    cpSync(join(checkout, "src/agent/subagents"), join(root, "src/agent/subagents"), { recursive: true });
    for (const n of ["prototyper.md", "test-scope.md"])
      symlinkSync(`../../src/agent/subagents/${n}`, join(root, ".claude/agents", n));
    expect(checkSubagentLinks(root)).toEqual([]);
    rmSync(join(root, ".claude/agents/test-scope.md"));
    writeFileSync(join(root, ".claude/agents/test-scope.md"), readFileSync(join(root, "src/agent/subagents/test-scope.md")));
    const failures = checkSubagentLinks(root);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("test-scope");
    rmSync(join(root, ".claude/agents/test-scope.md"));
    symlinkSync("../../src/agent/subagents/test-scope.md", join(root, ".claude/agents/test-scope.md"));
    expect(checkSubagentLinks(root)).toEqual([]);
    expect(existsSync(join(root, ".claude/agents/test-scope.md"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
