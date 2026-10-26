// 19.1–19.4: the prompt each agent starts with. A build pass and a sample have no user-facing start in
// the product, so these bind at the launcher that every agent start uses; the chat agent starts for real.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectAgentArgs } from "../../src/agent/launch.ts";
import { werkCommand } from "../../src/agent/prompt.ts";
import { type Chat, startChat } from "../../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../../src/test/fake-script.ts";
import { freshProject, type Project } from "../../src/test/project.ts";
import { CHECKOUT } from "./copy.ts";

const WERK_DIR = CHECKOUT;
const WERK = werkCommand(process.execPath, join(WERK_DIR, "src", "cli.ts"));
const BASE = "You are the build agent. Build ticket 07 of this project.";
const HEAD = "# werk — how to work with the decision map";
const RULES_HEADING = "## This project's build rules";
const RULES = ["Orders are stored in cents", "Every test runs on a real database", "A deploy is one tagged commit"];

const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const count = (text: string, part: string) => text.split(part).length - 1;

function writeMap(p: Project, howChildren: string[]): void {
  const cards = [
    { id: "root", title: "Shop" },
    { id: "how", parent: "root", title: "How the shop is built" },
    ...howChildren.map((title, i) => ({ id: `rule-${i}`, parent: "how", title })),
    { id: "orders", parent: "root", title: "Orders" },
  ];
  const lines = cards.map((c, i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", status: "decided", ...c } }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

test("19.1", () => {
  const p = freshProject();
  writeMap(p, RULES);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, WERK);
  const prompt = promptOf(args);
  expect(prompt.startsWith(`${BASE}\n\n${HEAD}`)).toBe(true);
  const instr = prompt.slice(prompt.indexOf(HEAD), prompt.indexOf(RULES_HEADING));
  expect(instr).toContain(`${WERK} help`);
  expect(instr).toContain(WERK_DIR);
  expect(instr).not.toContain("{{werk}}");
  expect(instr).not.toMatch(/#(werk|st|lp|how)-[a-z]/);
  const rules = prompt.slice(prompt.indexOf(RULES_HEADING));
  expect(prompt.indexOf(RULES_HEADING)).toBeGreaterThan(prompt.indexOf(HEAD));
  for (const t of RULES) expect(rules).toContain(t);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string; description: string }>;
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  expect(agents["test-scope"]?.description).toMatch(/pure or I\/O/);
  expect(agents.prototyper?.description).toMatch(/fork/);
  for (const a of Object.values(agents)) expect(a.prompt).toContain(WERK_DIR);
});

test("19.2", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const reply = [
    { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
    { event: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "hi" } } } },
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } },
  ];
  p.script({ roles: { chat: { replies: [reply] } } });
  let answered: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    answered = r;
  });
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => {
    if (part.kind === "block") answered();
  });
  chat.send("hello");
  await done;
  const launch = p.launches().find((l) => l.role === "chat");
  expect(launch).toBeDefined();
  const chatPrompt = promptOf(launch?.args ?? []);
  expect(chatPrompt).toContain(HEAD);
  expect(chatPrompt).toContain(RULES_HEADING);
  for (const t of RULES) expect(chatPrompt).toContain(t);

  const sample = projectAgentArgs({ role: "sample", base: "Sample three options for the open card.", project: p.dir }, WERK);
  const samplePrompt = promptOf(sample);
  expect(samplePrompt).not.toContain(HEAD);
  expect(samplePrompt).not.toContain(RULES_HEADING);
  for (const t of RULES) expect(samplePrompt).not.toContain(t);
}, 30_000);

test("19.3", () => {
  const p = freshProject();
  writeMap(p, []);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, WERK));
  expect(prompt).toContain(HEAD);
  expect(prompt).not.toContain(RULES_HEADING);
});

test("19.4", () => {
  // werk's own checkout: its AGENTS.md includes the instructions; the map has build rules.
  const p = freshProject();
  writeMap(p, RULES);
  const own = readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8");
  expect(own).toContain("@src/agent/instructions.md");
  const args = projectAgentArgs({ role: "builder", base: BASE, project: CHECKOUT, log: join(p.dir, ".werk", "log.jsonl") }, WERK);
  const prompt = promptOf(args);
  console.log(`copies of the instructions in the started prompt: ${count(prompt, HEAD)}`);
  expect(count(prompt, HEAD)).toBe(1);
  expect(prompt.indexOf(RULES_HEADING)).toBeGreaterThan(prompt.indexOf(HEAD));
  for (const t of RULES) expect(prompt).toContain(t);
});
