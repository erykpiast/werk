// Held-out steps 19.1-19.4: the prompts of the agents that werk starts.
// No command starts a build pass or a sample agent, so these tests first look for that entry point,
// then check the prompt at the launch seam that such a pass would use.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectAgentArgs } from "../src/agent/launch.ts";
import { fillWerk, INSTRUCTIONS, werkCommand } from "../src/agent/prompt.ts";
import { startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const WERK = werkCommand(process.execPath, join(CHECKOUT, "src", "cli.ts"));
const BASE = "You are the build agent. Build the ticket below.";
const promptOf = (args: string[]) => args[args.indexOf("--append-system-prompt") + 1] as string;

function writeMap(p: Project, cards: { id: string; parent?: string; title: string }[]): void {
  const lines = cards.map((c, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: { kind: "card", status: "decided", who: "me", ...c },
    }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}
const RULES = [
  { id: "root", title: "Shop" },
  { id: "how", parent: "root", title: "How the shop is built" },
  { id: "r1", parent: "how", title: "Tests use a real database" },
  { id: "r2", parent: "how", title: "Money is stored in cents" },
  { id: "r3", parent: "how", title: "A deploy is one tagged commit" },
];

async function entryPoints(p: Project): Promise<string> {
  return (await p.werk(["help"])).out;
}

test("19.1 a build pass in another project starts with its instructions, subagents and rule titles", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  const args = projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, WERK);
  const prompt = promptOf(args);
  const text = fillWerk(INSTRUCTIONS, WERK).trimEnd();
  expect(prompt.startsWith(`${BASE}\n\n${text}`)).toBe(true);
  expect(text).toContain(`${WERK} show`);
  expect(text).not.toMatch(/#(werk|st|lp|vi|pr|al|ms|how)[-\w]*\b/);
  const after = prompt.slice(prompt.indexOf(text) + text.length);
  for (const r of RULES.slice(2)) expect(after).toContain(r.title);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1] as string);
  expect(Object.keys(agents).sort()).toEqual(["prototyper", "test-scope"]);
  for (const a of Object.values(agents)) expect((a as { prompt: string }).prompt).toContain(CHECKOUT);
  const help = await entryPoints(p);
  expect(help).toMatch(/^\s{2}build\b/m);
});

test("19.2 a chat agent gets the instructions, a sample agent does not", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  p.script({ roles: { chat: { replies: [[{ event: { type: "result", subtype: "success", result: "ok" } }]] } } });
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const parts: unknown[] = [];
  const chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => parts.push(part));
  chat.send("hello");
  for (let i = 0; i < 100 && p.launches().length === 0; i++) await Bun.sleep(50);
  await chat.close();
  const launch = p.launches()[0];
  expect(launch).toBeDefined();
  const chatPrompt = promptOf(launch?.args ?? []);
  expect(chatPrompt).toContain(fillWerk(INSTRUCTIONS, "X").split("\n")[0] as string);
  expect(chatPrompt).toContain("Tests use a real database");
  const sample = promptOf(projectAgentArgs({ role: "sample", base: "You sample.", project: p.dir }, WERK));
  expect(sample).not.toContain("# werk — how to work with the decision map");
  expect(sample).not.toContain("Tests use a real database");
  const help = await entryPoints(p);
  expect(help).toMatch(/^\s{2}sample\b/m);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = freshProject();
  writeMap(p, RULES.slice(0, 2));
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, WERK));
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).not.toContain("build rules");
  const help = await entryPoints(p);
  expect(help).toMatch(/^\s{2}build\b/m);
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = freshProject();
  writeMap(p, RULES);
  writeFileSync(join(p.dir, "AGENTS.md"), readFileSync(join(CHECKOUT, "AGENTS.md"), "utf8"));
  const prompt = promptOf(projectAgentArgs({ role: "builder", base: BASE, project: p.dir }, WERK));
  // The agent reads AGENTS.md itself, with its include, so the full prompt holds it once.
  const agentsMd = readFileSync(join(p.dir, "AGENTS.md"), "utf8");
  const included = agentsMd.includes("@src/agent/instructions.md") ? 1 : 0;
  const heading = "# werk — how to work with the decision map";
  expect(prompt.split(heading).length - 1 + included).toBe(1);
  expect(prompt).toContain("Tests use a real database");
  const help = await entryPoints(p);
  expect(help).toMatch(/^\s{2}build\b/m);
});
