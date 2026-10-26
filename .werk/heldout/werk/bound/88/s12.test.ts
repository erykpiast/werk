import { expect, test } from "bun:test";
import { chat, freshProject, logLines, ok, type Project, seed, card } from "./lib.ts";

function logsChat(p: Project) {
  chat(p, "logs", [
    { kind: "tool_result", text: "one log per conversation", speaker: "agent", at: "10:00" },
    { kind: "spoken", text: "how do we store a chat?", speaker: "person", at: "10:01" },
    { kind: "spoken", text: "we keep one log per conversation and never rewrite it", speaker: "agent", at: "10:02" },
  ]);
}

test("12.1 a unique quote becomes an excerpt ghost", async () => {
  const p = freshProject();
  seed(p, [card("x", "X", "open")]);
  logsChat(p);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "x"]);
  const before = logLines(p).length;
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  const after = logLines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("store");
  const citing = (await ok(p, ["show", "store"])).out;
  expect(citing).toContain("-> supported_by    store:ex0  one log per conversation  (ghost, held)");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toStartWith("excerpt store:ex0  [open]  proposed\none log per conversation\n");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: 6ae61be7");
  expect(ex).toContain("message: 3");
  expect(ex).toContain("span: 8..32");
}, 60_000);

test("12.2 a quote that is not unique fails and writes nothing", async () => {
  const p = freshProject();
  seed(p, [card("x", "X", "open")]);
  chat(p, "talk", [
    { kind: "spoken", text: "ship the reader first", speaker: "person", at: "1" },
    { kind: "spoken", text: "ship the reader first", speaker: "agent", at: "2" },
    { kind: "spoken", text: "retry, then retry again", speaker: "person", at: "3" },
  ]);
  await ok(p, ["add", "c", "--title", "C", "--parent", "x"]);
  const before = logLines(p);
  const a = await p.werk(["quote", "c", "talk", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "c", "talk", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("2 times in message");
  const c = await p.werk(["quote", "c", "talk", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect((await p.werk(["show", "c:ex0"])).code).not.toBe(0);
  expect((await ok(p, ["show", "c"])).out).not.toContain("supported_by");
  expect(logLines(p)).toEqual(before);
}, 60_000);

test("12.3 tool output is never quotable", async () => {
  const p = freshProject();
  seed(p, [card("x", "X", "open")]);
  chat(p, "talk", [
    { kind: "tool_result", text: "exit code 137 from the runner", speaker: "agent", at: "1" },
    { kind: "tool_call", text: "run exit code 137", speaker: "agent", at: "2" },
    { kind: "tooling", text: "note: exit code 137", speaker: "agent", at: "3" },
    { kind: "spoken", text: "the runner died", speaker: "person", at: "4" },
  ]);
  await ok(p, ["add", "c", "--title", "C", "--parent", "x"]);
  const r = await p.werk(["quote", "c", "talk", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect((await p.werk(["show", "c:ex0"])).code).not.toBe(0);
}, 60_000);

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  seed(p, [card("x", "X", "open")]);
  logsChat(p);
  await ok(p, ["add", "c", "--title", "C", "--parent", "x"]);
  await ok(p, ["quote", "c", "logs", "one log per conversation"]);
  const shown = (await ok(p, ["show", "c:ex0"])).out;
  let n = logLines(p).length;
  const add = await p.werk(["add", "c:ex1", "--kind", "excerpt", "--title", "made up words"]);
  expect(add.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  const retitle = await p.werk(["retitle", "c:ex0", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["edit", "c:ex0", "--body", "other text"]);
  expect(edit.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect((await ok(p, ["show", "c:ex0"])).out).toBe(shown);
  await ok(p, ["say", "c:ex0", "Is this right?"]);
  expect((await ok(p, ["show", "c:ex0"])).out).toContain("Is this right?");
  await ok(p, ["accept", "c", "--actor", "you"]);
  n = logLines(p).length;
  const again = await p.werk(["edit", "c:ex0", "--body", "other text"]);
  expect(again.code).not.toBe(0);
  const again2 = await p.werk(["retitle", "c:ex0", "other words"]);
  expect(again2.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  const now = (await ok(p, ["show", "c:ex0"])).out;
  expect(now).toContain("one log per conversation");
  expect(now).not.toContain("other");
}, 60_000);

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  seed(p, [card("x", "X", "open")]);
  logsChat(p);
  await ok(p, ["add", "first", "--title", "First", "--parent", "x"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "x"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const head = (await ok(p, ["show", "second"])).out.split("\n")[0] as string;
  expect(head).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["one log per conversation", "speaker: agent", "said at: 10:02", "session: 6ae61be7", "message: ", "span: 8..32"])
    expect(ex).toContain(s);
}, 60_000);
