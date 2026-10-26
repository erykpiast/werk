import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, events, lines, ok, type Project, w, withRoot } from "./lib.ts";

const msg = (kind: string, text: string, speaker: string, at: string, session = "sess-1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

async function ghostCard(p: Project, id = "gc") {
  await ok(p, "add", id, "--title", `Ghost ${id}`, "--parent", "root");
}

test("12.1 unique quote becomes excerpt ghost; message position is 3", async () => {
  const p = withRoot();
  await ghostCard(p);
  chat(p, "conv", [
    msg("tool_result", "output", "agent", "t0"),
    msg("spoken", "please decide", "person", "t1"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "2026-02-02T10:00:00Z"),
  ]);
  const n = lines(p).length;
  const r = await ok(p, "quote", "gc", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  const added = events(p).slice(n);
  expect(added.length).toBe(1);
  expect(added[0]!.type).toBe("excerpt.quoted");
  const pl = added[0]!.payload;
  expect(pl.card).toBe("gc");
  expect(pl.title).toBe("one log per conversation");
  expect(pl.speaker).toBe("agent");
  expect(pl.said_at).toBe("2026-02-02T10:00:00Z");
  expect(pl.session).toBe("sess-1");
  const text = "we keep one log per conversation and never rewrite it";
  expect(pl.start).toBe(text.indexOf("one log per conversation"));
  expect(pl.end).toBe(pl.start + "one log per conversation".length);
  expect(pl.message).toBe(3);
});

test("12.2 non-unique quote fails, says which case, writes nothing", async () => {
  const p = withRoot();
  await ghostCard(p);
  chat(p, "conv", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "ship the reader first", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  const n = lines(p).length;
  const a = await w(p, "quote", "gc", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await w(p, "quote", "gc", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message 2/);
  const c = await w(p, "quote", "gc", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
});

test("12.3 tool-only text is not quotable", async () => {
  const p = withRoot();
  await ghostCard(p);
  chat(p, "conv", [
    msg("tool_result", "exit code 137 from the runner", "agent", "t0"),
    msg("tool_call", "run exit code 137", "agent", "t1"),
    msg("tooling", "note exit code 137", "agent", "t2"),
    msg("spoken", "something else", "person", "t3"),
  ]);
  const n = lines(p).length;
  const r = await w(p, "quote", "gc", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
});

test("12.4 excerpt words cannot be written or changed by hand; note ok; still frozen after accept", async () => {
  const p = withRoot();
  await ghostCard(p);
  chat(p, "conv", [msg("spoken", "we keep one log per conversation", "agent", "t1")]);
  await ok(p, "quote", "gc", "conv", "one log per conversation");
  const ex = "gc:ex0";
  let n = lines(p).length;
  const add = await w(p, "add", "gc:ex1", "--kind", "excerpt", "--title", "made up");
  expect(add.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  for (const args of [
    ["retitle", ex, "new words"],
    ["edit", ex, "--body", "new"],
  ]) {
    const r = await w(p, ...args);
    expect(r.code).not.toBe(0);
  }
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", ex)).out).toContain("one log per conversation");
  await ok(p, "say", ex, "a note");
  expect(events(p).at(-1)!.type).toBe("note.added");
  await ok(p, "accept", "gc", "--actor", "you");
  n = lines(p).length;
  for (const args of [
    ["retitle", ex, "new words"],
    ["edit", ex, "--body", "new"],
  ]) {
    const r = await w(p, ...args);
    expect(r.code).not.toBe(0);
  }
  expect(lines(p).length).toBe(n);
  expect((await ok(p, "show", ex)).out).toContain("one log per conversation");
});

test("12.5 excerpt follows its citing card: discard and accept", async () => {
  const p = withRoot();
  await ok(p, "add", "a", "--title", "A", "--parent", "root");
  await ok(p, "add", "b", "--title", "B", "--parent", "root");
  chat(p, "conv", [msg("spoken", "alpha words here", "person", "t1", "S9"), msg("spoken", "beta words there", "agent", "t2", "S9")]);
  await ok(p, "quote", "a", "conv", "alpha words");
  await ok(p, "quote", "b", "conv", "beta words");
  await ok(p, "discard", "a");
  expect((await w(p, "show", "a")).code).not.toBe(0);
  expect((await w(p, "show", "a:ex0")).code).not.toBe(0);
  await ok(p, "accept", "b", "--actor", "you");
  expect((await ok(p, "show", "b")).out).not.toContain("proposed");
  const ex = (await ok(p, "show", "b:ex0")).out;
  expect(ex).not.toContain("proposed");
  expect(ex).toContain("beta words");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: t2");
  expect(ex).toContain("session: S9");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("span: 0..10");
});

test("62.5 an excerpt also enters as a ghost, one event", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  chat(p, "conv", [msg("spoken", "hello there", "person", "t1")]);
  const n = lines(p).length;
  const r = await ok(p, "quote", "c", "conv", "hello");
  expect(r.out).toContain("proposed");
  expect(lines(p).length).toBe(n + 1);
  const s = (await ok(p, "show", "c:ex0")).out;
  expect(s).toContain("proposed");
  expect(s).toContain("hello");
});

test("67.1 quote becomes a ghost excerpt with pointer; card shows supported_by", async () => {
  const p = withRoot();
  card(p, "werk-excerpt", { title: "Excerpt" });
  chat(p, "s1", [
    msg("spoken", "hi", "assistant", "t0"),
    msg("spoken", "Every quote in the imported map was written from memory", "user", "t1", "sess-77"),
  ]);
  const r = await w(p, "quote", "#werk-excerpt", "s1", "written from memory");
  expect(r.code).toBe(0);
  const ex = (await ok(p, "show", "werk-excerpt:ex0")).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("session: sess-77");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("speaker: user");
  const t = "Every quote in the imported map was written from memory";
  expect(ex).toContain(`span: ${t.indexOf("written from memory")}..${t.length}`);
  expect((await ok(p, "show", "werk-excerpt")).out).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("67.2 the span finds the quote again in the transcript", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  const rows = [msg("spoken", "q", "user", "t0"), msg("spoken", "the assistant says the tool never guesses at all", "assistant", "t1")];
  chat(p, "s", rows);
  await ok(p, "quote", "c", "s", "never guesses");
  const out = (await ok(p, "show", "c:ex0")).out;
  const m = /message: (\d+)/.exec(out)!;
  const sp = /span: (\d+)\.\.(\d+)/.exec(out)!;
  const line = JSON.parse(rows[Number(m[1])]!);
  expect(line.text.slice(Number(sp[1]), Number(sp[2]))).toBe("never guesses");
  expect(line.speaker).toBe("assistant");
  expect(out).toContain("speaker: assistant");
});

test("67.3 one changed character fails and changes nothing", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  chat(p, "s", [msg("spoken", "the tool never guesses", "user", "t0")]);
  const n = lines(p).length;
  const r = await w(p, "quote", "c", "s", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  expect((await w(p, "show", "c:ex0")).code).not.toBe(0);
});

test("67.4 quote in two messages fails naming both", async () => {
  const p = withRoot();
  card(p, "c", { title: "C" });
  chat(p, "s", [
    msg("spoken", "x", "user", "t0"),
    msg("spoken", "y", "user", "t0"),
    msg("spoken", "z", "user", "t0"),
    msg("spoken", "it fails instead of guessing", "user", "t1"),
    msg("spoken", "a", "user", "t0"),
    msg("spoken", "b", "user", "t0"),
    msg("spoken", "c", "user", "t0"),
    msg("spoken", "yes fails instead of guessing", "assistant", "t1"),
  ]);
  const n = lines(p).length;
  const r = await w(p, "quote", "c", "s", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("3");
  expect(r.err).toContain("7");
  expect(lines(p).length).toBe(n);
});

test("67.5 a ghost excerpt is accepted like every ghost", async () => {
  const p = withRoot();
  await ghostCard(p, "gc");
  chat(p, "s", [msg("spoken", "some quoted words", "user", "t0")]);
  await ok(p, "quote", "gc", "s", "quoted words");
  await ok(p, "accept", "gc:ex0", "--actor", "you");
  const e = (await ok(p, "show", "gc:ex0")).out;
  expect(e).not.toContain("proposed");
  expect((await ok(p, "show", "gc")).out).toMatch(/supported_by\s+gc:ex0/);
});

test("06.1 / 06.2 excerpt on a decided card stages as ghost with pending link; accept makes link live", async () => {
  const p = withRoot();
  card(p, "d", { title: "Decided card", why: "reason", body: "body text" });
  chat(p, "s", [msg("spoken", "support for the card", "user", "t0")]);
  const r = await ok(p, "quote", "d", "s", "support for");
  expect(r.out).toContain("proposed");
  expect(r.out).not.toContain("added");
  const ex = (await ok(p, "show", "d:ex0")).out;
  expect(ex).toContain("proposed");
  expect(ex).toMatch(/supported_by\s+d.*\(held\)/);
  const d = (await ok(p, "show", "d")).out;
  expect(d).toContain("[decided]");
  expect(d).toContain("Decided card");
  expect(d).toContain("body text");
  expect(d).toMatch(/supported_by\s+d:ex0.*\(ghost, held\)/);
  const n = lines(p).length;
  await ok(p, "accept", "d:ex0", "--actor", "you");
  expect(events(p).slice(n).every((e) => e.type === "change.accepted")).toBe(true);
  const after = (await ok(p, "show", "d")).out;
  expect(after).toMatch(/supported_by\s+d:ex0\s/);
  expect(after).not.toContain("held");
  expect(after).toContain("Say");
});
