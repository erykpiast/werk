// Held-out steps 19.1-19.4: the prompt each started agent gets. No verb or route starts a build pass
// or a sample, so those prompts are read at the launcher every agent launcher uses; the chat agent
// is started through the real chat launcher with the fake agent, which records its arguments.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { fillWerk, INSTRUCTIONS } from "../src/agent/prompt.ts";
import { startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const CHECKOUT = join(import.meta.dir, "..");
const WERK = "/opt/werk-home/bun /opt/werk-home/src/cli.ts";
const BASE = "You are the build agent. Build ticket 07: add a refund button.";
const HEADING = "## This project's build rules";
const TEXT = fillWerk(INSTRUCTIONS, WERK).trimEnd();
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;
const RULES = ["Tests run against a real database", "Money is stored in cents", "A deploy is one tagged commit"];

function writeMap(dir: string, cards: { id: string; parent?: string; title?: string }[]): void {
  const lines = cards.map(({ id, parent, title }, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      type: "node.added",
      actor: "you",
      payload: { kind: "card", id, parent, title: title ?? `Title of ${id}`, status: "decided" },
    }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const THREE = [
  { id: "root" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "db", parent: "how", title: RULES[0] },
  { id: "money", parent: "how", title: RULES[1] },
  { id: "deploy", parent: "how", title: RULES[2] },
];

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
  delete process.env[FAKE_DIR_VAR];
});

test("19.1 a build pass in another project", () => {
  const project = freshProject();
  writeMap(project.dir, THREE);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK);
  const prompt = promptOf(args);
  expect(prompt.startsWith(`${BASE}\n\n${TEXT}`)).toBe(true);
  expect(TEXT).toContain(WERK);
  // No card id of werk's own map appears in the instructions.
  expect(TEXT).not.toMatch(/#(werk|st|lp|vi|pr|al|ms|how)[\w-]*\b/);
  const after = prompt.slice(prompt.indexOf(TEXT) + TEXT.length);
  for (const t of RULES) expect(after).toContain(t);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string) as Record<string, { prompt: string }>;
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect(a.prompt).toContain(WERK);
});

async function chatPrompt(project: Project): Promise<string> {
  process.env[FAKE_DIR_VAR] = project.env[FAKE_DIR_VAR];
  project.script({ roles: { chat: { replies: [[]] } } });
  const chat = startChat(project.dir, join(project.dir, ".werk", "log.jsonl"), () => undefined);
  chat.send("hello");
  for (let i = 0; i < 100 && project.launches().length === 0; i++) await Bun.sleep(50);
  await chat.close();
  const launch = project.launches()[0];
  if (launch === undefined) throw new Error("the chat agent did not start");
  return promptOf(launch.args);
}

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const project = freshProject();
  writeMap(project.dir, THREE);
  const chat = await chatPrompt(project);
  expect(chat).toContain("how to work with the decision map");
  expect(chat).toContain(HEADING);
  for (const t of RULES) expect(chat).toContain(t);
  const sample = promptOf(projectAgentArgs({ role: "sample", base: "You sample options.", project: project.dir }));
  expect(sample).not.toContain("how to work with the decision map");
  expect(sample).not.toContain(HEADING);
  for (const t of RULES) expect(sample).not.toContain(t);
});

test("19.3 a project with no build rules gets no title list", () => {
  const project = freshProject();
  writeMap(project.dir, [{ id: "root" }, { id: "how", parent: "root", title: "How it is built" }]);
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: project.dir }, WERK));
  expect(prompt).toContain(TEXT);
  expect(prompt).not.toContain(HEADING);
});

test("19.4 in werk's own checkout the instructions appear one time", () => {
  // A temporary copy of werk's own checkout: its AGENTS.md and its map log.
  const copy = realpathSync(mkdtempSync(join(tmpdir(), "werk-own-")));
  temps.push(copy);
  cpSync(join(CHECKOUT, "AGENTS.md"), join(copy, "AGENTS.md"));
  cpSync(join(CHECKOUT, "src"), join(copy, "src"), { recursive: true });
  const project = freshProject();
  writeMap(project.dir, THREE);
  cpSync(join(project.dir, ".werk"), join(copy, ".werk"), { recursive: true });
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: copy }, WERK));
  const agentsMd = readFileSync(join(copy, "AGENTS.md"), "utf8");
  expect(agentsMd).toContain("@src/agent/instructions.md");
  // Claude Code reads AGENTS.md, which includes the text once; the prompt must not add it again.
  const marker = "how to work with the decision map";
  expect(prompt.split(marker).length - 1).toBe(0);
  expect(prompt.indexOf(HEADING)).toBeGreaterThan(-1);
  for (const t of RULES) expect(prompt.indexOf(t)).toBeGreaterThan(prompt.indexOf(HEADING));
});
