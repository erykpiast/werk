import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chat, chatLine, events, lines, ok, w, withRoot } from "./h.ts";

test("12.1 unique quote becomes an excerpt ghost", async () => {
  const p = withRoot();
  chat(p, "conv", [
    chatLine("tool_result", "exit 0", "agent"),
    chatLine("spoken", "ship it", "person", "2026-02-02T10:00:00Z", "sess9"),
    chatLine("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-02-02T10:01:00Z", "sess9"),
  ]);
  await ok(p, "add", "citer", "--title", "Citing card");
  const n = lines(p).length;
  const r = await w(p, "quote", "citer", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  expect(lines(p).length).toBe(n + 1);
  const e = events(p).at(-1);
  expect(e.type).toBe("excerpt.quoted");
  const x = e.payload;
  expect(x.card).toBe("citer");
  expect(x.title).toBe("one log per conversation");
  expect(x.speaker).toBe("agent");
  expect(x.said_at).toBe("2026-02-02T10:01:00Z");
  expect(x.session).toBe("sess9");
  const text = "we keep one log per conversation and never rewrite it";
  expect(x.start).toBe(text.indexOf("one log per conversation"));
  expect(x.end).toBe(x.start + "one log per conversation".length);
  const show = (await ok(p, "show", x.id)).out;
  expect(show).toContain("proposed");
  expect(show).toMatch(/supported_by\s+citer/);
  expect(await ok(p, "show", "citer").then((s) => s.out)).toMatch(/supported_by\s+\S+.*\(ghost, held\)/);
  // the step says position 3 (the third line, counted from one); the product counts from zero
  expect(x.message).toBe(3);
});

test("12.2 quote that is not unique fails and writes nothing", async () => {
  const p = withRoot();
  chat(p, "conv", [
    chatLine("spoken", "ship the reader first", "person"),
    chatLine("spoken", "ok, ship the reader first then", "agent"),
    chatLine("spoken", "retry, then retry again", "person"),
  ]);
  await ok(p, "add", "citer", "--title", "Citing card");
  const n = lines(p).length;
  const a = await w(p, "quote", "citer", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await w(p, "quote", "citer", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await w(p, "quote", "citer", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no exact match/);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "citer")).out).not.toContain("supported_by");
});

test("12.3 tool output is never quotable", async () => {
  const p = withRoot();
  chat(p, "conv", [
    chatLine("tool_result", "exit code 137 from the runner", "agent"),
    chatLine("tool_call", "run exit code 137 check", "agent"),
    chatLine("tooling", "note: exit code 137", "agent"),
    chatLine("spoken", "that failed", "person"),
  ]);
  await ok(p, "add", "citer", "--title", "Citing card");
  const n = lines(p).length;
  const r = await w(p, "quote", "citer", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(lines(p).length).toBe(n);
});

test("12.4 an excerpt's words cannot be written by hand", async () => {
  const p = withRoot();
  chat(p, "conv", [chatLine("spoken", "we keep one log per conversation", "agent")]);
  await ok(p, "add", "citer", "--title", "Citing card");
  const q = await ok(p, "quote", "citer", "conv", "one log per conversation");
  const id = /^(\S+):/.exec(q.out)?.[1] as string;
  const n = lines(p).length;
  expect((await w(p, "add", "citer:ex9", "--kind", "excerpt", "--title", "mine")).code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await w(p, "retitle", id, "new words")).code).not.toBe(0);
  expect((await w(p, "edit", id, "--body", "new words")).code).not.toBe(0);
  expect((await w(p, "propose", id, "--title", "new words")).code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await w(p, "say", id, "a note")).code).toBe(0);
  expect((await ok(p, "show", id)).out).toContain("a note");
  await ok(p, "accept", "citer", "--actor", "you");
  expect((await w(p, "edit", id, "--body", "again")).code).not.toBe(0);
  expect((await ok(p, "show", id)).out).toContain("one log per conversation");
});

test("12.5 the excerpt follows its citing card", async () => {
  const p = withRoot();
  chat(p, "conv", [
    chatLine("spoken", "alpha words here", "person", "2026-03-03T00:00:00Z", "sessA"),
    chatLine("spoken", "beta words there", "agent", "2026-03-03T00:01:00Z", "sessA"),
  ]);
  await ok(p, "add", "one", "--title", "One");
  await ok(p, "add", "two", "--title", "Two");
  const a = await ok(p, "quote", "one", "conv", "alpha words");
  const b = await ok(p, "quote", "two", "conv", "beta words");
  const ida = /^(\S+):/.exec(a.out)?.[1] as string;
  const idb = /^(\S+):/.exec(b.out)?.[1] as string;
  await ok(p, "discard", "one");
  expect((await w(p, "show", "one")).code).not.toBe(0);
  expect((await w(p, "show", ida)).code).not.toBe(0);
  await ok(p, "accept", "two", "--actor", "you");
  const ex = (await ok(p, "show", idb)).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const part of ["beta words", "speaker: agent", "said at: 2026-03-03T00:01:00Z", "session: sessA", "message: 1", "span: 0..10"])
    expect(ex).toContain(part);
});

// ---- 67 ----
test("67.1 quote becomes a ghost excerpt on the citing card", async () => {
  const p = withRoot();
  chat(p, "s1", [
    chatLine("spoken", "hello", "assistant"),
    chatLine("spoken", "Every quote in the imported map was written from memory", "user"),
  ]);
  await ok(p, "add", "werk-excerpt", "--title", "Excerpts");
  const r = await w(p, "quote", "#werk-excerpt", "s1", "written from memory");
  expect(r.code).toBe(0);
  const x = events(p).at(-1).payload;
  expect(x.speaker).toBe("user");
  expect(x.message).toBe(1);
  const full = "Every quote in the imported map was written from memory";
  expect(x.start).toBe(full.indexOf("written from memory"));
  expect(x.end).toBe(full.length);
  expect(x.session).toBe("sess1");
  const ex = (await ok(p, "show", x.id)).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("speaker: user");
  expect((await ok(p, "show", "werk-excerpt")).out).toMatch(/supported_by\s+\S+/);
});

test("67.2 the pointer finds the quote again", async () => {
  const p = withRoot();
  const rows = [chatLine("spoken", "q", "user"), chatLine("tool_call", "x", "assistant"), chatLine("spoken", "Alpha the tool never guesses, beta", "assistant")];
  chat(p, "s1", rows);
  await ok(p, "add", "c", "--title", "C");
  await ok(p, "quote", "c", "s1", "the tool never guesses");
  const x = events(p).at(-1).payload;
  const log = readFileSync(join(p.dir, ".werk", "chats", "s1.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const msg = log[x.message];
  expect(msg.text.slice(x.start, x.end)).toBe("the tool never guesses");
  expect(msg.speaker).toBe("assistant");
  expect(x.speaker).toBe("assistant");
});

test("67.3 one changed character fails", async () => {
  const p = withRoot();
  chat(p, "s1", [chatLine("spoken", "the tool never guesses", "user")]);
  await ok(p, "add", "c", "--title", "C");
  const n = lines(p).length;
  const r = await w(p, "quote", "c", "s1", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", "c")).out).not.toContain("supported_by");
});

test("67.4 a quote in two messages names both", async () => {
  const p = withRoot();
  const rows = ["a", "b", "c", "x fails instead of guessing x", "d", "e", "f", "y fails instead of guessing y"].map((t) => chatLine("spoken", t, "user"));
  chat(p, "s1", rows);
  await ok(p, "add", "c", "--title", "C");
  const n = lines(p).length;
  const r = await w(p, "quote", "c", "s1", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(lines(p).length).toBe(n);
});

test("67.5 a ghost excerpt is accepted like any ghost", async () => {
  const p = withRoot();
  chat(p, "s1", [chatLine("spoken", "words to keep", "user")]);
  await ok(p, "add", "c", "--title", "C");
  await ok(p, "accept", "c", "--actor", "you");
  const q = await ok(p, "quote", "c", "s1", "words to keep");
  const id = /^(\S+):/.exec(q.out)?.[1] as string;
  expect((await ok(p, "show", id)).out).toContain("proposed");
  await ok(p, "accept", id, "--actor", "you");
  const ex = (await ok(p, "show", id)).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect((await ok(p, "show", "c")).out).toMatch(/supported_by\s+\S+\s+words to keep\n/);
});
