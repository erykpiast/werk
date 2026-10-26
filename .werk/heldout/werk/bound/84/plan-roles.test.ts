import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { modelFlags } from "../src/agent/role-model.ts";
import { runWriter } from "../src/plan/writer.ts";
import { startChat, type Chat, type ChatEvent } from "../src/serve/chat.ts";
import { MODEL_CHOICES, OPUS, SONNET } from "../src/serve/chat-model.ts";
import { FAKE_DIR_VAR } from "../src/test/fake-script.ts";
import { answer, board, mapProject, specText, ticket, withTarget, writers } from "./plan-helpers.ts";

let chat: Chat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
  delete process.env[FAKE_DIR_VAR];
});
const flag = (args: string[] | undefined, name: string) => args?.[(args?.indexOf(name) ?? -2) + 1];
const cards = [{ id: "app" }, { id: "app-x", parent: "app" }];

async function planned() {
  const p = mapProject(cards);
  await withTarget(p);
  writers(p, "app", [
    { spec: specText(["One."]), tickets: { "01.md": ticket("One", "app, app-x", "", "1") }, specAnswers: [answer("a")] },
  ]);
  const run = await p.werk(["plan", "app"]);
  expect(run.code).toBe(0);
  return p;
}

test("76.1", async () => {
  const p = await planned();
  const l = p.launches();
  expect(l.map((x) => x.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const x of l) {
    expect(flag(x.args, "--model")).toBe(OPUS);
    expect(x.args).not.toContain("--advisor");
    expect(x.args).not.toContain("opus");
    expect(x.args).not.toContain("sonnet");
  }
  expect(board(p).tickets.has("app/01")).toBe(true);
});

test("76.2", async () => {
  const p = await planned();
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const init = { event: { type: "system", subtype: "init", session_id: "s-1" } };
  const result = { event: { type: "result", subtype: "success", result: "ok", session_id: "s-1" } };
  p.script({ roles: { chat: { replies: [[init, result], [init, result]], exit: 0 } } });
  const events: ChatEvent[] = [];
  chat = startChat(p.dir, join(p.dir, ".werk", "log.jsonl"), (e) => events.push(e));
  const wait = async (n: number) => {
    for (let i = 0; i < 500 && events.filter((e) => e.kind === "end").length < n; i++) await Bun.sleep(10);
  };
  const choice = (label: string) => MODEL_CHOICES.find((c) => c.label === label)!;
  chat.setModel(choice("Opus"));
  chat.send({ text: "hi", turn: "t1", card: "root" });
  await wait(1);
  chat.setModel(choice("Sonnet + Opus advisor"));
  chat.send({ text: "again", turn: "t2", card: "root" });
  for (let i = 0; i < 500 && p.launches().filter((l) => l.role === "chat").length < 2; i++) await Bun.sleep(10);
  const ch = p.launches().filter((l) => l.role === "chat");
  expect(flag(ch[0]?.args, "--model")).toBe(OPUS);
  expect(ch[0]?.args).not.toContain("--advisor");
  expect(flag(ch[1]?.args, "--model")).toBe(SONNET);
  expect(flag(ch[1]?.args, "--advisor")).toBe(OPUS);
  expect(flag(ch[1]?.args, "--resume")).toBe("s-1");
});

test("76.3", async () => {
  // Build verb: look for a way to start a builder; none is registered.
  const help = await (await import("../src/test/project.ts")).freshProject().werk(["help"]);
  expect(help.out).toMatch(/^\s*(build|run)\b/m);
  expect(modelFlags("builder")).toEqual(["--model", SONNET, "--advisor", OPUS]);
  expect(modelFlags("reviewer-design")).toEqual(["--model", SONNET]);
});

test("76.4", async () => {
  const p = mapProject(cards);
  p.script({ roles: { "no-such-role": { replies: [[]] } } });
  process.env[FAKE_DIR_VAR] = p.env[FAKE_DIR_VAR];
  const end = await runWriter({
    role: "no-such-role",
    base: "base",
    prompt: "go",
    project: p.dir,
    log: join(p.dir, ".werk", "log.jsonl"),
    agentLog: join(p.dir, ".werk", "x.jsonl"),
    timeoutMs: 5000,
    silenceMs: 5000,
  }).catch((e: Error) => ({ ok: false as const, reason: String(e.message) }));
  expect(end.ok).toBe(false);
  expect((end as { reason: string }).reason).toContain("no-such-role");
  expect(p.launches()).toEqual([]);
});

test("76.5", async () => {
  const p = await planned();
  for (const l of p.launches()) {
    const model = flag(l.args, "--model") as string;
    expect(model).toMatch(/^claude-[a-z]+-\d+-\d+/);
    expect(l.args).not.toContain("opus");
    expect(l.args).not.toContain("sonnet");
  }
});
