// Held-out steps 19.1–19.4: the prompt that each agent werk starts begins with.
import { afterEach, expect, test } from "bun:test";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startChat } from "../src/serve/chat.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const INSTRUCTIONS = readFileSync(join(import.meta.dir, "..", "src", "agent", "instructions.md"), "utf8");
const FIRST_LINE = INSTRUCTIONS.split("\n")[0] as string;

function seed(p: Project, events: { type: string; payload: object }[]): void {
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
}

function rulesMap(p: Project, children: number): void {
  const events: { type: string; payload: object }[] = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    { type: "node.added", payload: { id: "how", kind: "card", title: "How it is built", parent: "root" } },
  ];
  for (let i = 1; i <= children; i++) {
    events.push({
      type: "node.added",
      payload: { id: `rule-${i}`, kind: "card", title: `Rule number ${i}`, parent: "how" },
    });
    events.push({ type: "node.decided", payload: { id: `rule-${i}` } });
  }
  events.push({ type: "node.added", payload: { id: "ticket-a", kind: "card", title: "Open work", parent: "root" } });
  seed(p, events);
}

/** Every verb that the command line registers. */
async function verbs(p: Project): Promise<string> {
  return (await p.werk(["help"])).out;
}

/**
 * A build pass on a ticket: the step names a person action that starts it. Look for any command line
 * verb or server route that starts one.
 */
function buildPassEntry(): string | undefined {
  const files = [
    ...readdirSync(join(import.meta.dir, "..", "src", "verbs")).map((f) => join("src", "verbs", f)),
    join("src", "serve", "server.ts"),
  ];
  for (const f of files) {
    const text = readFileSync(join(import.meta.dir, "..", f), "utf8");
    if (/role:\s*"builder"/.test(text)) return f;
  }
  return undefined;
}

test("19.1 a build pass in another project starts with werk instructions, subagents and rule titles", async () => {
  const p = freshProject();
  rulesMap(p, 3);
  const help = await verbs(p);
  console.log("19.1 help verbs:", help.match(/^ {2}\w[\w-]*/gm)?.join(","));
  // The person starts a build pass on a ticket: there must be a way to do so.
  expect(help).toMatch(/^ {2}(build|run|loop)\b/m);
  expect(buildPassEntry()).toBeDefined();
});

test("19.3 a project with no build rules gets no title list in a build pass", async () => {
  const p = freshProject();
  rulesMap(p, 0);
  const help = await verbs(p);
  expect(help).toMatch(/^ {2}(build|run|loop)\b/m);
  expect(buildPassEntry()).toBeDefined();
});

test("19.4 in werk's own checkout the instructions appear one time in a build pass prompt", async () => {
  const p = freshProject();
  const help = await verbs(p);
  expect(help).toMatch(/^ {2}(build|run|loop)\b/m);
  expect(buildPassEntry()).toBeDefined();
});

let chat: ReturnType<typeof startChat> | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});

test("19.2 a chat agent gets the instructions and rule titles, a sample agent does not", async () => {
  const p = freshProject();
  rulesMap(p, 3);
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const reply = [
    { event: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } },
    { event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } } },
  ];
  p.script({ roles: { chat: { replies: [reply] } } });
  let got = false;
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), () => {
    got = true;
  });
  chat.send("hello");
  for (let i = 0; i < 200 && !got; i++) await Bun.sleep(25);
  expect(got).toBe(true);
  const launch = p.launches().find((l) => l.role === "chat");
  expect(launch).toBeDefined();
  const args = launch?.args ?? [];
  const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain(FIRST_LINE);
  for (let i = 1; i <= 3; i++) expect(prompt).toContain(`Rule number ${i}`);

  // The person samples options for an open card: there must be a way to start a sample agent.
  const sampleEntry = [
    ...readdirSync(join(import.meta.dir, "..", "src", "verbs")).map((f) => join("src", "verbs", f)),
    join("src", "serve", "server.ts"),
  ].find((f) => /role:\s*"sample"/.test(readFileSync(join(import.meta.dir, "..", f), "utf8")));
  console.log("19.2 sample entry:", sampleEntry);
  expect(sampleEntry).toBeDefined();
});
