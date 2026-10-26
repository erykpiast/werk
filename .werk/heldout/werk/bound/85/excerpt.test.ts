import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";
import { decided, events, lines, ok, root, seed, w } from "./h.ts";

const msg = (kind: string, text: string, speaker = "person", at = "t") =>
  JSON.stringify({ speaker, at, session: "sess-1", kind, text });
function chat(p: Project, name: string, ls: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${ls.join("\n")}\n`);
}
const show = async (p: Project, id: string) => (await w(p, ["show", id])).out;
const base = () => {
  const p = freshProject();
  seed(p, [...root()]);
  return p;
};

test("06.1", async () => {
  const p = base();
  seed(p, [decided("c", { title: "Cardc", why: "Because" })]);
  chat(p, "conv", [msg("spoken", "we keep the retry decision", "person", "t1")]);
  const r = await ok(p, ["quote", "c", "conv", "retry decision"]);
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  const ex = await show(p, "c:ex0");
  expect(ex).toContain("proposed");
  const s = await show(p, "c");
  expect(s).toMatch(/supported_by\s+c:ex0.*held\)/);
  expect(s).toContain("[decided]");
  expect(s).toContain("Cardc");
  expect(s).toContain("why: Because");
});

test("12.1", async () => {
  const p = base();
  seed(p, [{ type: "node.proposed", actor: "agent", payload: { id: "g", kind: "card", title: "G", parent: "root" } }]);
  const text = "we keep one log per conversation and never rewrite it";
  chat(p, "conv", [
    msg("tool_result", "output", "agent", "t0"),
    msg("spoken", "hello", "person", "t1"),
    msg("spoken", text, "agent", "t2"),
  ]);
  const n = lines(p).length;
  await ok(p, ["quote", "g", "conv", "one log per conversation"]);
  expect(lines(p).length).toBe(n + 1);
  const ev = events(p)[n]!;
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("g");
  expect(ev.payload.title).toBe("one log per conversation");
  expect(ev.payload.speaker).toBe("agent");
  expect(ev.payload.said_at).toBe("t2");
  expect(ev.payload.session).toBe("sess-1");
  expect(ev.payload.message).toBe(3);
  const at = text.indexOf("one log per conversation");
  expect(ev.payload.start).toBe(at);
  expect(ev.payload.end).toBe(at + "one log per conversation".length);
  expect(await show(p, "g")).toMatch(/supported_by\s+g:ex0.*held\)/);
});

test("12.2", async () => {
  const p = base();
  seed(p, [{ type: "node.proposed", actor: "agent", payload: { id: "g", kind: "card", title: "G", parent: "root" } }]);
  chat(p, "conv", [
    msg("spoken", "ship the reader first", "person"),
    msg("spoken", "ok, ship the reader first", "agent"),
    msg("spoken", "retry, then retry again", "person"),
  ]);
  const n = lines(p).length;
  let r = await w(p, ["quote", "g", "conv", "ship the reader first"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/2 messages/);
  r = await w(p, ["quote", "g", "conv", "retry"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/2 times in message/);
  r = await w(p, ["quote", "g", "conv", "a sentence nobody said"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match|no match/);
  expect(lines(p).length).toBe(n);
  expect((await w(p, ["show", "g:ex0"])).code).not.toBe(0);
});

test("12.3", async () => {
  const p = base();
  seed(p, [{ type: "node.proposed", actor: "agent", payload: { id: "g", kind: "card", title: "G", parent: "root" } }]);
  chat(p, "conv", [
    msg("tool_result", "exit code 137 from the runner", "agent"),
    msg("tool_call", "run exit code 137", "agent"),
    msg("tooling", "note exit code 137", "agent"),
    msg("spoken", "nothing here", "person"),
  ]);
  const n = lines(p).length;
  const r = await w(p, ["quote", "g", "conv", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match|no match/);
  expect(lines(p).length).toBe(n);
});

test("12.4", async () => {
  const p = base();
  seed(p, [{ type: "node.proposed", actor: "agent", payload: { id: "g", kind: "card", title: "G", parent: "root" } }]);
  chat(p, "conv", [msg("spoken", "we keep one log", "person")]);
  await ok(p, ["quote", "g", "conv", "one log"]);
  const n = lines(p).length;
  let r = await w(p, ["add", "g:ex9", "--kind", "excerpt", "--title", "my words"]);
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  r = await w(p, ["retitle", "g:ex0", "new words"]);
  expect(r.code).not.toBe(0);
  r = await w(p, ["edit", "g:ex0", "--body", "new body"]);
  expect(r.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(await show(p, "g:ex0")).toContain("one log");
  r = await w(p, ["say", "g:ex0", "a note"]);
  expect(r.code).toBe(0);
  await ok(p, ["accept", "g", "--actor", "you"]);
  r = await w(p, ["edit", "g:ex0", "--body", "new body"]);
  expect(r.code).not.toBe(0);
  const s = await show(p, "g:ex0");
  expect(s).toContain("one log");
  expect(s).not.toContain("new body");
});

test("12.5", async () => {
  const p = base();
  seed(p, [
    { type: "node.proposed", actor: "agent", payload: { id: "g1", kind: "card", title: "G1", parent: "root" } },
    { type: "node.proposed", actor: "agent", payload: { id: "g2", kind: "card", title: "G2", parent: "root" } },
  ]);
  chat(p, "conv", [msg("spoken", "first quote here", "person", "ta"), msg("spoken", "second quote here", "agent", "tb")]);
  await ok(p, ["quote", "g1", "conv", "first quote"]);
  await ok(p, ["quote", "g2", "conv", "second quote"]);
  await ok(p, ["discard", "g1"]);
  expect((await w(p, ["show", "g1"])).code).not.toBe(0);
  expect((await w(p, ["show", "g1:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "g2", "--actor", "you"]);
  expect(await show(p, "g2")).not.toMatch(/\bproposed\b/);
  const ex = await show(p, "g2:ex0");
  expect(ex).not.toMatch(/\bproposed\b/);
  for (const t of ["second quote", "speaker: agent", "said at: tb", "session: sess-1", "message: 1", "span: 0..12"])
    expect(ex).toContain(t);
});

test("67.1", async () => {
  const p = base();
  seed(p, [decided("werk-excerpt", { title: "Excerpt" })]);
  const text = "Every quote in the imported map was written from memory";
  chat(p, "s1", [msg("spoken", "hello", "agent"), msg("spoken", text, "user", "t9")]);
  await ok(p, ["quote", "#werk-excerpt", "s1", "written from memory"]);
  const ex = await show(p, "werk-excerpt:ex0");
  expect(ex).toContain("proposed");
  expect(ex).toContain("session: sess-1");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("speaker: user");
  const st = text.indexOf("written from memory");
  expect(ex).toContain(`span: ${st}..${st + "written from memory".length}`);
  expect(await show(p, "werk-excerpt")).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("67.2", async () => {
  const p = base();
  seed(p, [decided("werk-excerpt")]);
  const text = "The assistant said this exact thing today";
  chat(p, "s1", [msg("spoken", "q", "user"), msg("spoken", text, "assistant")]);
  await ok(p, ["quote", "werk-excerpt", "s1", "this exact thing"]);
  const ev = events(p).at(-1)!;
  const spoken = JSON.parse(
    require("node:fs").readFileSync(join(p.dir, ".werk", "chats", "s1.jsonl"), "utf8").split("\n")[ev.payload.message],
  );
  expect(spoken.text.slice(ev.payload.start, ev.payload.end)).toBe("this exact thing");
  expect(spoken.speaker).toBe("assistant");
  expect(await show(p, "werk-excerpt:ex0")).toContain("speaker: assistant");
});

test("67.3", async () => {
  const p = base();
  seed(p, [decided("c")]);
  chat(p, "s1", [msg("spoken", "the tool never guesses", "user")]);
  const n = lines(p).length;
  const r = await w(p, ["quote", "c", "s1", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  expect((await w(p, ["show", "c:ex0"])).code).not.toBe(0);
});

test("67.4", async () => {
  const p = base();
  seed(p, [decided("c")]);
  chat(p, "s1", [
    msg("spoken", "a"),
    msg("spoken", "b"),
    msg("spoken", "it fails instead of guessing"),
    msg("spoken", "c"),
    msg("spoken", "d"),
    msg("spoken", "e"),
    msg("spoken", "x"),
    msg("spoken", "again fails instead of guessing"),
  ].map((l, i) => l));
  const n = lines(p).length;
  const r = await w(p, ["quote", "c", "s1", "fails instead of guessing"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("2");
  expect(r.err).toContain("7");
  expect(lines(p).length).toBe(n);
});

test("67.5", async () => {
  const p = base();
  seed(p, [decided("c")]);
  chat(p, "s1", [msg("spoken", "quoted words here")]);
  await ok(p, ["quote", "c", "s1", "quoted words"]);
  await ok(p, ["accept", "c:ex0", "--actor", "you"]);
  expect(await show(p, "c:ex0")).not.toMatch(/\bproposed\b/);
  expect(await show(p, "c")).toMatch(/supported_by\s+c:ex0/);
  expect(await show(p, "c")).not.toContain("held");
});
