// Held-out steps 12.1-12.4: werk quote at the command line.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);
const msg = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-1", kind, text });

function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

async function base(p: Project) {
  await ok(p, ["add", "root", "--title", "Root"]);
  await ok(p, ["accept", "root", "--actor", "you"]);
  await ok(p, ["add", "storage", "--title", "Storage keeps one log", "--parent", "root"]);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  await base(p);
  chat(p, "conv1", [
    msg("tool_result", "files listed", "agent", "t0"),
    msg("spoken", "how do we store the history?", "person", "t1"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "t2"),
  ]);
  const before = lines(p);
  const r = await p.werk(["quote", "storage", "conv1", "one log per conversation"]);
  expect(r.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("storage");
  const show = (await ok(p, ["show", "storage"])).out;
  expect(show).toMatch(/supported_by\s+storage:ex0.*ghost, held/);
  const ex = (await ok(p, ["show", "storage:ex0"])).out;
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: t2");
  expect(ex).toContain("session: sess-1");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // The step: the message position is 3, because the hidden tool result line counts.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, writes nothing", async () => {
  const p = freshProject();
  await base(p);
  chat(p, "conv2", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "agreed, ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  const before = lines(p);
  const a = await p.werk(["quote", "storage", "conv2", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.werk(["quote", "storage", "conv2", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "storage", "conv2", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no exact match/);
  const show = (await ok(p, ["show", "storage"])).out;
  expect(show).not.toContain("supported_by");
  expect(show).not.toContain("Say");
  expect(lines(p)).toEqual(before);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = freshProject();
  await base(p);
  chat(p, "conv3", [
    msg("spoken", "why did the build die?", "person", "t0"),
    msg("tool_call", "check exit code 137", "agent", "t1"),
    msg("tool_result", "exit code 137 from the runner", "agent", "t2"),
    msg("tooling", "note: exit code 137 seen", "agent", "t3"),
    msg("spoken", "the runner ran out of memory", "agent", "t4"),
  ]);
  const before = lines(p);
  const r = await p.werk(["quote", "storage", "conv3", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "storage"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  await base(p);
  chat(p, "conv4", [msg("spoken", "we keep one log per conversation", "agent", "t0")]);
  await ok(p, ["quote", "storage", "conv4", "one log per conversation"]);
  const before = lines(p);
  const add = await p.werk(["add", "storage:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", "storage:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", "storage:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "storage:ex0"])).out.split("\n")[1]).toBe("one log per conversation");
  const say = await p.werk(["say", "storage:ex0", "a note on the quote"]);
  expect(say.code).toBe(0);
  expect((await ok(p, ["show", "storage:ex0"])).out).toContain("a note on the quote");
  await ok(p, ["accept", "storage", "--actor", "you"]);
  const n = lines(p).length;
  const edit2 = await p.werk(["propose", "storage:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit2.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "storage:ex0"])).out.split("\n")[1]).toBe("one log per conversation");
});
