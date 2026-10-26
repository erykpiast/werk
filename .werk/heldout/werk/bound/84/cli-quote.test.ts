import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, fresh, logLines, ok, seed } from "./cli-helpers.ts";

const msg = (kind: string, text: string, speaker: string, at: string, session = "sess-1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function chat(p: Project, name: string, lines: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

async function ghostCard(p: Project, id: string, title = "Ghost card") {
  await ok(p, ["add", id, "--title", title, "--parent", "root"]);
}

test("12.1 unique quote becomes excerpt ghost", async () => {
  const p = fresh();
  chat(p, "conv", [
    msg("tool_result", "exit 0", "agent", "t0"),
    msg("spoken", "please go on", "person", "t1"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-10-02T10:00:00Z"),
  ]);
  await ghostCard(p, "cite");
  const before = logLines(p).length;
  const r = await p.werk(["quote", "cite", "conv", "one log per conversation"]);
  expect(r.code).toBe(0);
  const lines = logLines(p);
  expect(lines.length).toBe(before + 1);
  const ev = JSON.parse(lines.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("cite");
  expect(ev.payload.speaker).toBe("agent");
  expect(ev.payload.said_at).toBe("2026-10-02T10:00:00Z");
  expect(ev.payload.session).toBe("sess-1");
  const text = "we keep one log per conversation and never rewrite it";
  expect(ev.payload.start).toBe(text.indexOf("one log per conversation"));
  expect(ev.payload.end).toBe(text.indexOf("one log per conversation") + "one log per conversation".length);
  expect(ev.payload.message).toBe(3);
  const show = (await ok(p, ["show", "cite"])).out;
  expect(show).toContain("one log per conversation");
  expect(show).toMatch(/supported_by/);
});

test("12.2 non-unique quote fails and writes nothing", async () => {
  const p = fresh();
  chat(p, "conv", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ghostCard(p, "cite");
  const before = logLines(p).length;
  const a = await p.werk(["quote", "cite", "conv", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.werk(["quote", "cite", "conv", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "cite", "conv", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(logLines(p).length).toBe(before);
  expect((await ok(p, ["show", "cite"])).out).not.toContain("excerpt");
});

test("12.3 tool output is not quotable", async () => {
  const p = fresh();
  chat(p, "conv", [
    msg("tool_result", "exit code 137 from the runner", "agent", "t0"),
    msg("tool_call", "run exit code 137", "agent", "t1"),
    msg("tooling", "note exit code 137", "agent", "t2"),
    msg("spoken", "hello", "person", "t3"),
  ]);
  await ghostCard(p, "cite");
  const before = logLines(p).length;
  const r = await p.werk(["quote", "cite", "conv", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(logLines(p).length).toBe(before);
});

async function quoted(p: Project, id: string) {
  chat(p, "conv", [msg("spoken", "we keep one log per conversation", "agent", "t1")]);
  await ghostCard(p, id);
  await ok(p, ["quote", id, "conv", "one log per conversation"]);
  return `${id}:ex0`;
}

test("12.4 excerpt words cannot be hand-written or changed", async () => {
  const p = fresh();
  const ex = await quoted(p, "cite");
  let n = logLines(p).length;
  const add = await p.werk(["add", "hand", "--kind", "excerpt", "--title", "mine", "--parent", "cite"]);
  expect(add.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  for (const args of [
    ["retitle", ex, "changed"],
    ["edit", ex, "--body", "changed"],
  ]) {
    const r = await p.werk(args);
    expect(r.code).not.toBe(0);
  }
  expect(logLines(p).length).toBe(n);
  expect((await ok(p, ["show", ex])).out).toContain("one log per conversation");
  await ok(p, ["say", ex, "a note"]);
  expect((await ok(p, ["show", ex])).out).toContain("a note");
  await ok(p, ["accept", "cite", "--actor", "you"]);
  n = logLines(p).length;
  const again = await p.werk(["edit", ex, "--body", "changed"]);
  expect(again.code).not.toBe(0);
  const again2 = await p.werk(["retitle", ex, "x"]);
  expect(again2.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect((await ok(p, ["show", ex])).out).toContain("one log per conversation");
});

test("12.5 excerpt follows its citing card", async () => {
  const p = fresh();
  chat(p, "conv", [msg("spoken", "alpha words here and beta words there", "agent", "t1")]);
  await ghostCard(p, "one");
  await ghostCard(p, "two");
  await ok(p, ["quote", "one", "conv", "alpha words"]);
  await ok(p, ["quote", "two", "conv", "beta words"]);
  await ok(p, ["discard", "one"]);
  expect((await p.werk(["show", "one"])).code).not.toBe(0);
  expect((await p.werk(["show", "one:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "two", "--actor", "you"]);
  const c = (await ok(p, ["show", "two"])).out;
  expect(c).not.toContain("ghost");
  const e = (await ok(p, ["show", "two:ex0"])).out;
  expect(e).not.toContain("ghost");
  expect(e).toContain("beta words");
  expect(e).toContain("agent");
  expect(e).toContain("sess-1");
  expect(e).toContain("t1");
});

test("67.1 unique quote from user message", async () => {
  const p = fresh([card("werk-excerpt", "Excerpt", { parent: "root" })]);
  chat(p, "s1", [
    msg("spoken", "hi", "agent", "t0"),
    msg("spoken", "Every quote in the imported map was written from memory", "user", "t1"),
  ]);
  const r = await p.werk(["quote", "#werk-excerpt", "s1", "written from memory"]);
  expect(r.code).toBe(0);
  const ev = JSON.parse(logLines(p).at(-1) as string);
  expect(ev.payload.speaker).toBe("user");
  expect(ev.payload.message).toBe(1);
  const t = "Every quote in the imported map was written from memory";
  expect(ev.payload.start).toBe(t.indexOf("written from memory"));
  expect(ev.payload.end).toBe(t.length);
  const ex = (await ok(p, ["show", ev.payload.id])).out;
  expect(ex).toMatch(/ghost|proposed/);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toMatch(/supported_by/);
});

test("67.2 span recovers quote", async () => {
  const p = fresh([card("werk-excerpt", "Excerpt", { parent: "root" })]);
  const lines = [msg("spoken", "q", "user", "t0"), msg("spoken", "the tool never guesses, ever", "assistant", "t1")];
  chat(p, "s1", lines);
  await ok(p, ["quote", "werk-excerpt", "s1", "never guesses"]);
  const ev = JSON.parse(logLines(p).at(-1) as string).payload;
  const line = JSON.parse(lines[ev.message] as string);
  expect(line.text.slice(ev.start, ev.end)).toBe("never guesses");
  expect(line.speaker).toBe("assistant");
  const shown = (await ok(p, ["show", ev.id])).out;
  expect(shown).toContain("assistant");
});

test("67.3 one changed character fails", async () => {
  const p = fresh([card("c", "C", { parent: "root" })]);
  chat(p, "s1", [msg("spoken", "the tool never guesses", "user", "t0")]);
  const n = logLines(p).length;
  const r = await p.werk(["quote", "c", "s1", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(logLines(p).length).toBe(n);
});

test("67.4 two messages named", async () => {
  const p = fresh([card("c", "C", { parent: "root" })]);
  const ls = ["a", "b", "c", "x fails instead of guessing", "d", "e", "f", "fails instead of guessing y"].map((t) =>
    msg("spoken", t, "user", "t"),
  );
  chat(p, "s1", ls);
  const n = logLines(p).length;
  const r = await p.werk(["quote", "c", "s1", "fails instead of guessing"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("3");
  expect(r.err).toContain("7");
  expect(logLines(p).length).toBe(n);
});

test("67.5 accept ghost excerpt", async () => {
  const p = fresh([card("c", "C", { parent: "root" })]);
  chat(p, "s1", [msg("spoken", "the tool never guesses", "user", "t0")]);
  await ok(p, ["quote", "c", "s1", "never guesses"]);
  const ex = "c:ex0";
  await ok(p, ["accept", ex, "--actor", "you"]);
  const e = (await ok(p, ["show", ex])).out;
  expect(e).not.toMatch(/ghost|proposed/);
  expect((await ok(p, ["show", "c"])).out).toContain("never guesses");
});
