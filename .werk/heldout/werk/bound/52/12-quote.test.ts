import { expect, test } from "bun:test";
import { card, chat, lines, ok, project, seed } from "./helpers.ts";

const row = (kind: string, text: string, speaker: string, at: string) => ({ speaker, at, session: "sess-42", kind, text });

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "design", [
    row("tool_result", "ls output", "agent", "2026-01-01T09:00:00Z"),
    row("spoken", "how do we store the chat?", "person", "2026-01-01T09:01:00Z"),
    row("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-01-01T09:02:00Z"),
  ]);
  await ok(p, ["add", "chat-log", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "chat-log", "design", "one log per conversation"]);
  expect(run.code).toBe(0);
  const added = lines(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0]).toMatchObject({ type: "excerpt.quoted", payload: { card: "chat-log" } });
  const ex = (added[0] as { payload: { id: string } }).payload.id;
  const card_ = (await ok(p, ["show", "chat-log"])).out;
  expect(card_).toMatch(new RegExp(`-> supported_by\\s+${ex}\\s`));
  const show = (await ok(p, ["show", ex])).out;
  expect(show.split("\n")[0]).toContain("proposed");
  expect(show).toContain("one log per conversation");
  expect(show).toContain("speaker: agent");
  expect(show).toContain("said at: 2026-01-01T09:02:00Z");
  expect(show).toContain("session: sess-42");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(show).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(show).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "plan", [
    row("spoken", "ship the reader first", "person", "t1"),
    row("spoken", "agreed, ship the reader first", "agent", "t2"),
    row("spoken", "retry, then retry again", "person", "t3"),
  ]);
  await ok(p, ["add", "reader", "--title", "Reader first", "--parent", "root"]);
  const before = lines(p).length;
  const a = await p.werk(["quote", "reader", "plan", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.werk(["quote", "reader", "plan", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.werk(["quote", "reader", "plan", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  const show = (await ok(p, ["show", "reader"])).out;
  expect(show).not.toContain("supported_by");
  expect(show).not.toContain("Say");
  expect(lines(p).length).toBe(before);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "ops", [
    row("tool_call", "run job; expect exit code 137", "agent", "t1"),
    row("tool_result", "exit code 137 from the runner", "agent", "t2"),
    row("tooling", "note: exit code 137 seen", "agent", "t3"),
    row("spoken", "the runner was killed", "agent", "t4"),
  ]);
  await ok(p, ["add", "oom", "--title", "Runner memory", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "oom", "ops", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/no (exact )?match/);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "oom"])).out).not.toContain(":ex");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "talk", [row("spoken", "the log is append only", "person", "t1")]);
  await ok(p, ["add", "log-rule", "--title", "Log rule", "--parent", "root"]);
  await ok(p, ["quote", "log-rule", "talk", "append only"]);
  let before = lines(p).length;
  const add = await p.werk(["add", "log-rule:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  const retitle = await p.werk(["propose", "log-rule:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", "log-rule:ex0", "--ops", JSON.stringify([{ tag: "new", new: "x" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "log-rule:ex0"])).out.split("\n")[1]).toBe("append only");
  await ok(p, ["say", "log-rule:ex0", "a note on the excerpt"]);
  expect(lines(p).at(-1)).toMatchObject({ type: "note.added", payload: { id: "log-rule:ex0", text: "a note on the excerpt" } });
  await ok(p, ["accept", "log-rule", "--actor", "you"]);
  before = lines(p).length;
  const again = await p.werk(["propose", "log-rule:ex0", "--title", "other words"]);
  expect(again.code).not.toBe(0);
  const again2 = await p.werk(["propose", "log-rule:ex0", "--ops", JSON.stringify([{ tag: "new", new: "x" }])]);
  expect(again2.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "log-rule:ex0"])).out.split("\n")[1]).toBe("append only");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "talk", [
    row("spoken", "first point here", "person", "2026-01-01T10:00:00Z"),
    row("spoken", "second point there", "agent", "2026-01-01T10:01:00Z"),
  ]);
  await ok(p, ["add", "one", "--title", "Card one", "--parent", "root"]);
  await ok(p, ["add", "two", "--title", "Card two", "--parent", "root"]);
  await ok(p, ["quote", "one", "talk", "first point"]);
  await ok(p, ["quote", "two", "talk", "second point"]);
  await ok(p, ["discard", "one"]);
  expect((await p.werk(["show", "one"])).code).not.toBe(0);
  expect((await p.werk(["show", "one:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "two", "--actor", "you"]);
  expect((await ok(p, ["show", "two"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "two:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["second point", "speaker: agent", "said at: 2026-01-01T10:01:00Z", "session: sess-42", "message: 1", "span: 0..12"])
    expect(ex).toContain(s);
});
