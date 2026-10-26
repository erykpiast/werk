// Held-out steps 12.1-12.5: werk quote and excerpts.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter((l) => l !== "");
const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });

function withChat(name: string, entries: string[]): Project {
  const p = freshProject();
  const root = { seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } };
  appendFileSync(logOf(p), `${JSON.stringify(root)}\n`);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${entries.join("\n")}\n`);
  return p;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

const SAID = "we keep one log per conversation and never rewrite it";
const logsChat = () =>
  withChat("logs", [
    msg("tool_result", "ran ls", "agent", "10:00"),
    msg("spoken", "how do we store a chat?", "person", "10:01"),
    msg("spoken", SAID, "agent", "10:02"),
  ]);

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = logsChat();
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before + 1);
  const event = JSON.parse(after.at(-1) as string);
  expect(event.payload.card).toBe("store");
  const id = event.payload.id as string;
  const card = (await ok(p, ["show", "store"])).out;
  expect(card).toContain(`-> supported_by    ${id}`);
  const ex = (await ok(p, ["show", id])).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-42");
  const start = SAID.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // The step: message position is 3, because the hidden tool result line counts.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = withChat("plan", [
    msg("spoken", "I say ship the reader first", "person", "t0"),
    msg("spoken", "agreed, ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ok(p, ["add", "reader", "--title", "Reader goes first", "--parent", "root"]);
  const before = lines(p);
  const showBefore = (await ok(p, ["show", "reader"])).out;
  const two = await p.werk(["quote", "reader", "plan", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "reader", "plan", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message/);
  const none = await p.werk(["quote", "reader", "plan", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect((await ok(p, ["show", "reader"])).out).toBe(showBefore);
  expect((await p.werk(["show", "reader:ex0"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = withChat("run", [
    msg("tool_call", "check exit code 137 now", "agent", "t0"),
    msg("tool_result", "exit code 137 from the runner", "agent", "t1"),
    msg("tooling", "note: exit code 137", "agent", "t2"),
    msg("spoken", "the runner died", "person", "t3"),
  ]);
  await ok(p, ["add", "oom", "--title", "The runner runs out of memory", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "oom", "run", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect((await p.werk(["show", "oom:ex0"])).code).not.toBe(0);
  expect((await ok(p, ["show", "oom"])).out).not.toContain("supported_by");
  expect(lines(p)).toEqual(before);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = logsChat();
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const exShow = async () => (await ok(p, ["show", "store:ex0"])).out;
  const original = await exShow();

  let before = lines(p);
  const add = await p.werk(["add", "store:ex1", "--title", "my own words", "--kind", "excerpt"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);

  const retitle = await p.werk(["propose", "store:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", "store:ex0", "--ops", JSON.stringify([{ tag: "new", new: "text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await exShow()).toBe(original);

  await ok(p, ["say", "store:ex0", "Is this the right quote?"]);
  expect(lines(p).length).toBe(before.length + 1);
  expect((await ok(p, ["inbox"])).out + JSON.stringify(lines(p))).toContain("Is this the right quote?");

  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p);
  const after = await p.werk(["propose", "store:ex0", "--title", "other words"]);
  expect(after.code).not.toBe(0);
  const afterOps = await p.werk(["propose", "store:ex0", "--ops", JSON.stringify([{ tag: "new", new: "text" }])]);
  expect(afterOps.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await exShow()).toContain("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = logsChat();
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const part of ["one log per conversation", "speaker: agent", "said at: 10:02", "session: sess-42", "message: 2", "span: 8..32"])
    expect(ex).toContain(part);
});
