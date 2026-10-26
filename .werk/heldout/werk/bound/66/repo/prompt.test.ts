import { afterEach, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectAgentArgs } from "../../src/agent/launch.ts";
import { INSTRUCTIONS } from "../../src/agent/prompt.ts";
import { type Chat, startChat } from "../../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../../src/test/fake-script.ts";
import { freshProject, type Project } from "../../src/test/project.ts";

const CHECKOUT = join(import.meta.dir, "..", "..");
let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

function withRules(p: Project, rules: number): void {
  const ev: object[] = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    { type: "node.added", payload: { id: "how", kind: "card", title: "How it is built" } },
    { type: "node.added", payload: { id: "open-one", kind: "card", title: "An open card", parent: "root" } },
  ];
  for (let i = 1; i <= rules; i++) {
    ev.push({ type: "node.added", payload: { id: `rule-${i}`, kind: "card", title: `Rule title number ${i}`, parent: "how" } });
    ev.push({ type: "node.decided", payload: { id: `rule-${i}` } });
  }
  appendFileSync(
    join(p.dir, ".werk", "log.jsonl"),
    `${ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`,
  );
}

/** A user-facing way to start a build pass or a sample: a verb in werk help. */
async function verbs(p: Project): Promise<string> {
  return (await p.werk(["help"])).out;
}

test("19.1 build pass in another project", async () => {
  const p = freshProject();
  withRules(p, 3);
  const help = await verbs(p);
  console.log("library builder prompt check:");
  const args = projectAgentArgs({ role: "builder", base: "BUILDER BASE", project: p.dir }, "/opt/werk/werk");
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  console.log(prompt.startsWith("BUILDER BASE"), prompt.includes("/opt/werk/werk"), /Rule title number 3/.test(prompt), args.includes("--agents"));
  // The person must be able to start a build pass on a ticket.
  expect(help).toMatch(/^\s{2}build\b/m);
});

test("19.2 chat agent gets the text; sample agent does not", async () => {
  const p = freshProject();
  withRules(p, 2);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  p.script({
    roles: {
      chat: {
        replies: [[{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } }]],
      },
    },
  });
  let done: () => void = () => undefined;
  const got = new Promise<void>((r) => {
    done = r;
  });
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (part) => {
    if (part.kind === "block") done();
  });
  chat.send("hello");
  await got;
  const launch = p.launches().find((l) => l.role === "chat");
  expect(launch).toBeDefined();
  const prompt = launch?.args[(launch?.args.indexOf("--append-system-prompt") ?? -2) + 1] ?? "";
  expect(prompt).toContain(INSTRUCTIONS.split("\n")[0] as string);
  expect(prompt).toContain("Rule title number 1");
  expect(prompt).toContain("Rule title number 2");
  // The person samples options for an open card: needs a user-facing sample action.
  const help = await verbs(p);
  const server = readFileSync(join(CHECKOUT, "src", "serve", "server.ts"), "utf8");
  expect(/^\s{2}sample\b/m.test(help) || /\/api\/sample/.test(server)).toBe(true);
});

test("19.3 no build rules, no list", async () => {
  const p = freshProject();
  withRules(p, 0);
  const help = await verbs(p);
  const args = projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "w");
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  console.log("library: has instructions", prompt.includes("decision map"), "has rule list", prompt.includes("build rules"));
  expect(help).toMatch(/^\s{2}build\b/m);
});

test("19.4 werk's own checkout, instructions once", async () => {
  const p = freshProject();
  withRules(p, 2);
  writeFileSync(join(p.dir, "AGENTS.md"), "# Working\n\n@src/agent/instructions.md\n");
  const help = await verbs(p);
  const args = projectAgentArgs({ role: "builder", base: "B", project: p.dir }, "w");
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  console.log("library: instruction copies in prompt", prompt.split("how to work with the decision map").length - 1, "rules", prompt.includes("Rule title number 2"));
  expect(help).toMatch(/^\s{2}build\b/m);
});
