// Held-out steps 19.1-19.4: the prompts of the agents that werk starts.
import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Chat, startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

function seed(p: Project, rules: string[]) {
  const cards = [
    { id: "root", title: "Shop" },
    { id: "how", parent: "root", title: "How the shop is built" },
    ...rules.map((t, i) => ({ id: `rule-${i}`, parent: "how", title: t })),
  ];
  const ev = cards.map((c, i) =>
    JSON.stringify({ seq: i + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", status: "decided", ...c } }),
  );
  writeFileSync(join(p.dir, ".werk", "log.jsonl"), `${ev.join("\n")}\n`);
}

/** The verb by which a person starts a build pass on a ticket: the help names one. */
async function buildVerb(p: Project): Promise<string | undefined> {
  const help = (await p.werk(["help"])).out;
  return [...help.matchAll(/^ {2}([a-z-]+)\b.*\n\s+(.*)$/gm)].find((m) => /build pass|\bbuild\b.*ticket/i.test(m[2] ?? ""))?.[1];
}

const RULES = ["Money is stored in cents", "Every page loads under a second", "Errors carry a code"];

test("19.1 a build pass in another project starts with the werk instructions, subagents and rule titles", async () => {
  const p = freshProject();
  seed(p, RULES);
  const verb = await buildVerb(p);
  expect(verb).toBeDefined();
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = freshProject();
  seed(p, RULES);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const reply = [
    { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } },
  ];
  p.script({ roles: { chat: { replies: [reply] } } });
  let done = false;
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => {
    if (part.kind === "block") done = true;
  });
  chat.send("hello");
  while (!done) await Bun.sleep(20);
  const args = p.launches()[0]?.args ?? [];
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).toContain("## This project's build rules");
  for (const r of RULES) expect(prompt).toContain(r);
  // Sampling options for an open card: the person needs a way to start a sample agent.
  const help = (await p.werk(["help"])).out;
  expect(help).toMatch(/^ {2}sample\b/m);
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = freshProject();
  seed(p, []);
  const verb = await buildVerb(p);
  expect(verb).toBeDefined();
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = freshProject();
  const verb = await buildVerb(p);
  expect(verb).toBeDefined();
});
