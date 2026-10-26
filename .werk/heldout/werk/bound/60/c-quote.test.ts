// Held-out steps 12.1-12.5: quote and excerpts.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter((l) => l !== "");
const seed = (p: Project, type: string, payload: object, actor = "you") =>
  appendFileSync(logOf(p), `${JSON.stringify({ seq: lines(p).length + 1, at: "t", actor, type, payload })}\n`);
const msg = (kind: string, text: string, speaker = "person", at = "t") =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });
function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}
function base(): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  return p;
}
async function ghost(p: Project, id: string) {
  const r = await p.werk(["add", id, "--title", `Card ${id}`, "--why", "w", "--parent", "root"]);
  expect(r.code).toBe(0);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = base();
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "design", [
    msg("tool_result", "ls output", "agent", "t0"),
    msg("spoken", "how do we store chats?", "person", "t1"),
    msg("spoken", said, "agent", "t2"),
  ]);
  await ghost(p, "log-card");
  const before = lines(p).length;
  const r = await p.werk(["quote", "log-card", "design", "one log per conversation"]);
  console.log("12.1 out", r.out, r.err);
  expect(r.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("log-card");
  const id = ev.payload.id;
  const show = await p.werk(["show", id]);
  console.log("12.1 show", show.out);
  expect(show.out).toContain("proposed");
  expect(show.out).toContain("one log per conversation");
  expect(show.out).toContain("speaker: agent");
  expect(show.out).toContain("said at: t2");
  expect(show.out).toContain("session: sess-42");
  // The step names message position 3 with a hidden tool result line counted (0-based numbering gives 2).
  expect(show.out).toContain("message: 3");
  const start = said.indexOf("one log per conversation");
  expect(show.out).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(show.out).toMatch(/<- supported_by\s+log-card/);
});

test("12.2 a quote that is not unique fails, says which case, writes nothing", async () => {
  const p = base();
  chat(p, "c", [
    msg("spoken", "ship the reader first", "person"),
    msg("spoken", "ok, ship the reader first", "agent"),
    msg("spoken", "retry, then retry again", "person"),
  ]);
  await ghost(p, "k");
  const before = lines(p);
  const a = await p.werk(["quote", "k", "c", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "k", "c", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "k", "c", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  console.log("12.2", a.err, b.err, c.err);
  expect(lines(p)).toEqual(before);
  const show = await p.werk(["show", "k"]);
  expect(show.out).not.toContain("supported_by");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = base();
  chat(p, "c", [
    msg("tool_result", "exit code 137 from the runner", "agent"),
    msg("tool_call", "check exit code 137", "agent"),
    msg("tooling", "note: exit code 137", "agent"),
    msg("spoken", "the build failed", "person"),
  ]);
  await ghost(p, "k");
  const before = lines(p);
  const r = await p.werk(["quote", "k", "c", "exit code 137"]);
  console.log("12.3", r.err);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = base();
  chat(p, "c", [msg("spoken", "seats are the unit we bill", "person", "t1")]);
  await ghost(p, "k");
  expect((await p.werk(["quote", "k", "c", "seats are the unit"])).code).toBe(0);
  let before = lines(p);
  const add = await p.werk(["add", "k:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", "k:ex0", "--title", "other words"]);
  const edit = await p.werk(["propose", "k:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  console.log("12.4", add.err, retitle.err, edit.err);
  expect(retitle.code).not.toBe(0);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "k:ex0"])).out).toContain("seats are the unit");
  const note = await p.werk(["say", "k:ex0", "nice quote"]);
  expect(note.code).toBe(0);
  expect(JSON.parse(lines(p).at(-1) as string)).toMatchObject({ type: "note.added", payload: { id: "k:ex0" } });
  expect((await p.werk(["accept", "k", "--actor", "you"])).code).toBe(0);
  before = lines(p);
  const again = await p.werk(["propose", "k:ex0", "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  const again2 = await p.werk(["propose", "k:ex0", "--title", "other words"]);
  console.log("12.4 after accept", again.err, again2.err);
  expect(again.code).not.toBe(0);
  expect(again2.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const show = await p.werk(["show", "k:ex0"]);
  expect(show.out).toContain("seats are the unit");
  expect(show.out).not.toContain("other");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = base();
  chat(p, "c", [msg("spoken", "alpha words here", "person", "t1"), msg("spoken", "beta words there", "agent", "t2")]);
  await ghost(p, "one");
  await ghost(p, "two");
  expect((await p.werk(["quote", "one", "c", "alpha words"])).code).toBe(0);
  expect((await p.werk(["quote", "two", "c", "beta words"])).code).toBe(0);
  expect((await p.werk(["discard", "one"])).code).toBe(0);
  const s1 = await p.werk(["show", "one"]);
  const s1e = await p.werk(["show", "one:ex0"]);
  console.log("12.5 gone", s1.code, s1.err, s1e.code, s1e.err);
  expect(s1.code).not.toBe(0);
  expect(s1e.code).not.toBe(0);
  expect((await p.werk(["accept", "two", "--actor", "you"])).code).toBe(0);
  const s2 = await p.werk(["show", "two"]);
  const s2e = await p.werk(["show", "two:ex0"]);
  console.log("12.5 accepted", s2.out, s2e.out);
  expect(s2.out.split("\n")[0]).not.toContain("proposed");
  expect(s2e.out.split("\n")[0]).not.toContain("proposed");
  for (const part of ["beta words", "speaker: agent", "said at: t2", "session: sess-42", "message: 1", "span: 0..10"])
    expect(s2e.out).toContain(part);
});
