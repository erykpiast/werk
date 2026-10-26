// Held-out steps 12.1–12.5: werk quote at the command line.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);
const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-1", kind, text });

function setup(chat: string[]): Project {
  const p = freshProject();
  appendFileSync(logOf(p), `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } })}\n`);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(join(p.dir, ".werk", "chats", "conv.jsonl"), `${chat.join("\n")}\n`);
  return p;
}
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = setup([
    msg("tool_result", "ls output", "agent", "10:00"),
    msg("spoken", "how do we store chats?", "person", "10:01"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "store", "conv", "one log per conversation"]);
  expect(r.code).toBe(0);
  const card = (await ok(p, ["show", "store"])).out;
  expect(card).toMatch(/-> supported_by\s+store:ex0\s+one log per conversation/);
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-1");
  const text = "we keep one log per conversation and never rewrite it";
  const start = text.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(lines(p).length).toBe(before + 1);
  const event = JSON.parse(lines(p).at(-1) as string);
  expect(event.payload.card).toBe("store");
  expect(event.payload.id).toBe("store:ex0");
  // The step says the message position is 3 (the hidden tool result counts).
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = setup([
    msg("spoken", "ship the reader first", "person", "1"),
    msg("spoken", "ok, ship the reader first", "agent", "2"),
    msg("spoken", "retry, then retry again", "person", "3"),
  ]);
  await ok(p, ["add", "plan", "--title", "Plan", "--parent", "root"]);
  const before = lines(p);
  const a = await p.werk(["quote", "plan", "conv", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "plan", "conv", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "plan", "conv", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "plan"])).out;
  expect(show).not.toContain("supported_by");
  expect((await p.werk(["show", "plan:ex0"])).code).not.toBe(0);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = setup([
    msg("tool_result", "exit code 137 from the runner", "agent", "1"),
    msg("tool_call", "check exit code 137", "agent", "2"),
    msg("tooling", "note: exit code 137", "agent", "3"),
    msg("spoken", "the runner failed", "person", "4"),
  ]);
  await ok(p, ["add", "plan", "--title", "Plan", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "plan", "conv", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "plan:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = setup([msg("spoken", "seats are the unit we bill", "person", "1")]);
  await ok(p, ["add", "seat", "--title", "Bill per seat", "--parent", "root"]);
  await ok(p, ["quote", "seat", "conv", "seats are the unit"]);
  let before = lines(p);
  const add = await p.werk(["add", "seat:ex1", "--title", "my own words", "--kind", "excerpt"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", "seat:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", "seat:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "seat:ex0"])).out).toContain("seats are the unit");
  const note = await p.werk(["say", "seat:ex0", "is this right?"]);
  expect(note.code).toBe(0);
  expect((await ok(p, ["inbox"])).out + JSON.stringify(lines(p).at(-1))).toContain("is this right?");
  await ok(p, ["accept", "seat", "--actor", "you"]);
  before = lines(p);
  const edit2 = await p.werk(["propose", "seat:ex0", "--title", "other words"]);
  expect(edit2.code).not.toBe(0);
  const edit3 = await p.werk(["propose", "seat:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit3.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const ex = (await ok(p, ["show", "seat:ex0"])).out;
  expect(ex).toContain("seats are the unit");
  expect(ex).not.toContain("other");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = setup([
    msg("spoken", "seats are the unit we bill", "person", "t0"),
    msg("spoken", "invoices go out monthly", "agent", "t1"),
  ]);
  await ok(p, ["add", "seat", "--title", "Bill per seat", "--parent", "root"]);
  await ok(p, ["add", "invoice", "--title", "Monthly invoices", "--parent", "root"]);
  await ok(p, ["quote", "seat", "conv", "seats are the unit"]);
  await ok(p, ["quote", "invoice", "conv", "go out monthly"]);
  await ok(p, ["discard", "seat"]);
  expect((await p.werk(["show", "seat"])).code).not.toBe(0);
  expect((await p.werk(["show", "seat:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "invoice", "--actor", "you"]);
  const card = (await ok(p, ["show", "invoice"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "invoice:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["go out monthly", "speaker: agent", "said at: t1", "session: sess-1", "message: 1", "span: 9..23"])
    expect(ex).toContain(s);
});
