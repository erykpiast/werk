// Held-out steps 12.1-12.5: `werk quote` and the excerpt it makes.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const log = (p: Project) => readFileSync(logOf(p), "utf8");
const events = (p: Project) =>
  log(p)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const line = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });

function chat(p: Project, name: string, lines: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

/** A project with a real root and a ghost card "design" under it, citing a conversation. */
async function withGhost(p: Project, id = "design") {
  await ok(p, ["add", "top", "--title", "Top", "--why", "w"]);
  await ok(p, ["accept", "top", "--actor", "you"]);
  await ok(p, ["add", id, "--title", `Card ${id}`, "--why", "it cites conv", "--parent", "top"]);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  const agentText = "ok, so we keep one log per conversation and never rewrite it";
  chat(p, "conv", [
    line("tool_result", "files listed", "tool", "2026-01-01T00:00:00Z"),
    line("spoken", "how do we store chats?", "person", "2026-01-01T00:00:01Z"),
    line("spoken", agentText, "agent", "2026-01-01T00:00:02Z"),
  ]);
  await withGhost(p);
  const before = events(p).length;
  const r = await p.werk(["quote", "design", "conv", "one log per conversation"]);
  expect(r.code).toBe(0);
  const after = events(p);
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("design");
  const id = ev.payload.id;
  const show = await ok(p, ["show", id]);
  expect(show.out).toContain("proposed");
  expect(show.out).toContain("one log per conversation");
  expect(show.out).toContain("speaker: agent");
  expect(show.out).toContain("said at: 2026-01-01T00:00:02Z");
  expect(show.out).toContain("session: sess-42");
  expect(show.out).toMatch(/<- supported_by\s+design/);
  const start = agentText.indexOf("one log per conversation");
  expect(show.out).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(show.out).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, writes nothing", async () => {
  const p = freshProject();
  chat(p, "conv", [
    line("spoken", "ship the reader first", "person", "t0"),
    line("spoken", "agreed: ship the reader first", "agent", "t1"),
    line("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await withGhost(p);
  const before = log(p);
  const a = await p.werk(["quote", "design", "conv", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "design", "conv", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "design", "conv", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(log(p)).toBe(before);
  const show = await ok(p, ["show", "design"]);
  expect(show.out).not.toContain("supported_by");
  expect(show.out).not.toContain("design:ex");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = freshProject();
  chat(p, "conv", [
    line("spoken", "why did the build die?", "person", "t0"),
    line("tool_call", "grep 'exit code 137' runner.log", "agent", "t1"),
    line("tool_result", "exit code 137 from the runner", "tool", "t2"),
    line("tooling", "note: exit code 137 seen", "tooling", "t3"),
    line("spoken", "the runner ran out of memory", "agent", "t4"),
  ]);
  await withGhost(p);
  const before = log(p);
  const r = await p.werk(["quote", "design", "conv", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(log(p)).toBe(before);
  expect(events(p).some((e) => e.type === "excerpt.quoted")).toBe(false);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  chat(p, "conv", [line("spoken", "we keep one log per conversation", "agent", "t0")]);
  await withGhost(p);
  await ok(p, ["quote", "design", "conv", "one log per conversation"]);
  const ex = "design:ex0";
  let before = log(p);
  const add = await p.werk(["add", "hand-ex", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(log(p)).toBe(before);
  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "body text" }])]);
  expect(edit.code).not.toBe(0);
  expect(log(p)).toBe(before);
  expect((await ok(p, ["show", ex])).out).toContain("one log per conversation");
  const say = await p.werk(["say", ex, "a note on the excerpt"]);
  expect(say.code).toBe(0);
  expect(events(p).at(-1)).toMatchObject({ type: "note.added", payload: { id: ex, text: "a note on the excerpt" } });
  await ok(p, ["accept", "design", "--actor", "you"]);
  before = log(p);
  const edit2 = await p.werk(["propose", ex, "--title", "changed after accept"]);
  expect(edit2.code).not.toBe(0);
  const edit3 = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "x" }])]);
  expect(edit3.code).not.toBe(0);
  expect(log(p)).toBe(before);
  const show = (await ok(p, ["show", ex])).out;
  expect(show.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  chat(p, "conv", [
    line("spoken", "first quote here", "person", "2026-02-02T10:00:00Z"),
    line("spoken", "and a second quote there", "agent", "2026-02-02T10:00:05Z"),
  ]);
  await withGhost(p, "one");
  await ok(p, ["add", "two", "--title", "Card two", "--why", "w", "--parent", "top"]);
  await ok(p, ["quote", "one", "conv", "first quote"]);
  await ok(p, ["quote", "two", "conv", "second quote"]);
  await ok(p, ["discard", "one"]);
  expect((await p.werk(["show", "one"])).code).not.toBe(0);
  expect((await p.werk(["show", "one:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "two", "--actor", "you"]);
  const card = (await ok(p, ["show", "two"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "two:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("second quote");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 2026-02-02T10:00:05Z");
  expect(ex).toContain("session: sess-42");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("span: 6..18");
});
