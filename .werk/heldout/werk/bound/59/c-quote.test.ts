// Held-out steps 12.1-12.5: werk quote.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });

function setup(chat: string[], conv = "conv1"): Project {
  const p = freshProject();
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } })}\n`,
  );
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${conv}.jsonl`), `${chat.join("\n")}\n`);
  return p;
}

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}

const AGENT_TEXT = "we keep one log per conversation and never rewrite it";

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = setup([
    msg("tool_result", "ls output", "agent", "t0"),
    msg("spoken", "how do we store chats?", "person", "t1"),
    msg("spoken", AGENT_TEXT, "agent", "t2"),
  ]);
  await ok(p, ["add", "store", "--title", "Chat storage", "--why", "w", "--parent", "root"]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "store", "conv1", "one log per conversation"]);
  expect(r.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("store");
  const id = ev.payload.id;
  const show = await ok(p, ["show", id]);
  expect(show.out).toContain("proposed");
  expect(show.out).toContain("one log per conversation");
  expect(show.out).toContain("speaker: agent");
  expect(show.out).toContain("said at: t2");
  expect(show.out).toContain("session: sess-42");
  expect(show.out).toMatch(/supported_by\s+store/);
  const start = AGENT_TEXT.indexOf("one log per conversation");
  expect(show.out).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // The step expects position 3 because the hidden tool result line counts.
  expect(show.out).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = setup([
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "agreed: ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ok(p, ["add", "plan", "--title", "Plan", "--why", "w", "--parent", "root"]);
  const before = lines(p);
  const two = await p.werk(["quote", "plan", "conv1", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "plan", "conv1", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message/);
  const none = await p.werk(["quote", "plan", "conv1", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  const show = await ok(p, ["show", "plan"]);
  expect(show.out).not.toContain("supported_by");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = setup([
    msg("tool_result", "exit code 137 from the runner", "agent", "t0"),
    msg("tool_call", "check exit code 137", "agent", "t1"),
    msg("tooling", "note: exit code 137 seen", "agent", "t2"),
    msg("spoken", "the runner died", "person", "t3"),
  ]);
  await ok(p, ["add", "oom", "--title", "OOM", "--why", "w", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "oom", "conv1", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = setup([msg("spoken", AGENT_TEXT, "agent", "t0")]);
  await ok(p, ["add", "store", "--title", "Chat storage", "--why", "w", "--parent", "root"]);
  await ok(p, ["quote", "store", "conv1", "one log per conversation"]);
  const id = "store:ex0";
  let before = lines(p);
  const plain = await p.werk(["add", "store:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", id, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "body text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", id])).out).toContain("one log per conversation");
  await ok(p, ["say", id, "a note on the excerpt"]);
  expect(lines(p).length).toBe(before.length + 1);
  expect(lines(p).at(-1)).toContain("a note on the excerpt");
  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p);
  const again = await p.werk(["propose", id, "--title", "other words"]);
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const show = await ok(p, ["show", id]);
  expect(show.out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = setup([
    msg("spoken", "first quoted sentence here", "person", "t0"),
    msg("spoken", "second quoted sentence there", "agent", "t1"),
  ]);
  await ok(p, ["add", "a", "--title", "A", "--why", "w", "--parent", "root"]);
  await ok(p, ["add", "b", "--title", "B", "--why", "w", "--parent", "root"]);
  await ok(p, ["quote", "a", "conv1", "first quoted sentence"]);
  await ok(p, ["quote", "b", "conv1", "second quoted sentence"]);
  await ok(p, ["discard", "a"]);
  expect((await p.werk(["show", "a"])).code).not.toBe(0);
  expect((await p.werk(["show", "a:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "b", "--actor", "you"]);
  const card = await ok(p, ["show", "b"]);
  expect(card.out.split("\n")[0]).not.toContain("proposed");
  const ex = await ok(p, ["show", "b:ex0"]);
  expect(ex.out.split("\n")[0]).not.toContain("proposed");
  for (const s of [
    "second quoted sentence",
    "speaker: agent",
    "said at: t1",
    "session: sess-42",
    "message: 1",
    "span: 0..22",
  ])
    expect(ex.out).toContain(s);
});
