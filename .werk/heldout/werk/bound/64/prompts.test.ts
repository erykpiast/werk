// Held-out steps 19.1-19.4: the prompt each agent that werk starts begins with. A build pass and
// a sample are started the way a person starts them: from the command line or the map's server.
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fillWerk, INSTRUCTIONS } from "../src/agent/prompt.ts";
import { type Chat, startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { type P, proj } from "./h.ts";

let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

function withRules(p: P, rules: string[]): void {
  p.seed("node.added", { id: "root", kind: "card", title: "Root", status: "decided" });
  p.seed("node.added", { id: "how", kind: "card", title: "How it is built", parent: "root", status: "decided" });
  for (const [i, title] of rules.entries())
    p.seed("node.added", { id: `rule-${i}`, kind: "card", title, parent: "how", status: "decided" });
  p.seed("node.added", { id: "ticket-1", kind: "card", title: "Ticket one", parent: "root" });
}

/** The verb a person runs to start a build pass on a ticket, if the command line has one. */
async function buildVerb(p: P): Promise<string | undefined> {
  const help = await p.ok("help");
  const verbs = [...help.matchAll(/^ {2}([a-z][a-z-]*)\b.*\n\s+(.*)$/gm)].map((m) => ({ name: m[1], text: m[2] }));
  return verbs.find((v) => /\bbuild\b|\bpass\b/i.test(`${v.name} ${v.text}`) && !/ticket-check/.test(v.name ?? ""))
    ?.name;
}

/** The verb a person runs to sample options for an open card, if the command line has one. */
async function sampleVerb(p: P): Promise<string | undefined> {
  const help = await p.ok("help");
  const verbs = [...help.matchAll(/^ {2}([a-z][a-z-]*)\b.*\n\s+(.*)$/gm)].map((m) => ({ name: m[1], text: m[2] }));
  return verbs.find((v) => /\bsample/i.test(`${v.name} ${v.text}`))?.name;
}

test("19.1 a build pass in another project starts with the werk instructions, its subagents and the rule titles", async () => {
  const p = proj();
  withRules(p, ["Rule A", "Rule B", "Rule C"]);
  const verb = await buildVerb(p);
  expect(verb, "a command that starts a build pass on a ticket").toBeDefined();
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async () => {
  const p = proj();
  withRules(p, ["Rule A", "Rule B"]);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  p.script({
    roles: {
      chat: {
        replies: [
          [
            { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
            { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } },
          ],
        ],
      },
    },
  });
  let got = false;
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => {
    if (part.kind === "block") got = true;
  });
  chat.send("hello");
  for (let i = 0; i < 200 && !got; i++) await Bun.sleep(25);
  expect(got).toBe(true);
  const launch = p.launches().find((l) => l.role === "chat");
  const args = launch?.args ?? [];
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).toContain("Rule A");
  expect(prompt).toContain("Rule B");

  const verb = await sampleVerb(p);
  expect(verb, "a command that samples options for an open card").toBeDefined();
});

test("19.3 a project with no build rules gets no title list", async () => {
  const p = proj();
  withRules(p, []);
  const verb = await buildVerb(p);
  expect(verb, "a command that starts a build pass on a ticket").toBeDefined();
});

test("19.4 in werk's own checkout the instructions appear one time", async () => {
  const p = proj();
  withRules(p, ["Rule A"]);
  expect(fillWerk(INSTRUCTIONS, "werk").length).toBeGreaterThan(0);
  const verb = await buildVerb(p);
  expect(verb, "a command that starts a build pass on a ticket").toBeDefined();
});
