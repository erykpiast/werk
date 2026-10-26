import { expect, test } from "bun:test";
import { chat, mk, said } from "./lib.ts";

const tool = (kind: string, text: string) => ({ speaker: "tool", at: "t", session: "sess-1", kind, text });

test("12.1 unique quote becomes excerpt ghost with pointer", async () => {
  const h = mk();
  h.card("cite", {});
  // make the citing card a ghost
  const h2 = mk();
  await h2.ok("add", "cite", "--title", "Cite card");
  chat(h2, "conv", [
    tool("tool_result", "ok"),
    said("person", "hello there"),
    said("agent", "we keep one log per conversation and never rewrite it", "2026-02-02T10:00:00Z", "sess-42"),
  ]);
  const before = h2.count();
  const r = await h2.w("quote", "cite", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  console.log(r.out);
  expect(h2.count()).toBe(before + 1);
  const ev = h2.events().at(-1);
  console.log(JSON.stringify(ev));
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("cite");
  expect(ev.payload.title).toBe("one log per conversation");
  expect(ev.payload.speaker).toBe("agent");
  expect(ev.payload.said_at).toBe("2026-02-02T10:00:00Z");
  expect(ev.payload.session).toBe("sess-42");
  const text = "we keep one log per conversation and never rewrite it";
  const start = text.indexOf("one log per conversation");
  expect(ev.payload.start).toBe(start);
  expect(ev.payload.end).toBe(start + "one log per conversation".length);
  // message position 3, the hidden tool result line counts
  const shown = (await h2.ok("show", "cite:ex0")) + r.out;
  console.log(shown);
  expect(ev.payload.message === 3 || /message 3\b/.test(shown) || /\b3\b/.test(shown)).toBe(true);
  expect(ev.payload.message).toBe(3);
  const card = await h2.ok("show", "cite");
  expect(card).toContain("supported_by");
  expect(card).toContain("cite:ex0");
});

async function setup() {
  const h = mk();
  await h.ok("add", "cite", "--title", "Cite card");
  return h;
}

test("12.2 non-unique quote fails, writes nothing", async () => {
  const h = await setup();
  chat(h, "conv", [
    said("person", "ship the reader first"),
    said("agent", "ok, ship the reader first"),
    said("person", "retry, then retry again"),
  ]);
  const n = h.count();
  const a = await h.w("quote", "cite", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await h.w("quote", "cite", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await h.w("quote", "cite", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no exact match|no match/);
  expect(h.count()).toBe(n);
  expect(await h.ok("show", "cite")).not.toContain("ex0");
});

test("12.3 tool output is never quotable", async () => {
  const h = await setup();
  chat(h, "conv", [
    tool("tool_result", "exit code 137 from the runner"),
    tool("tool_call", "run exit code 137"),
    tool("tooling", "note exit code 137"),
    said("person", "nothing relevant"),
  ]);
  const n = h.count();
  const r = await h.w("quote", "cite", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match|no match/);
  expect(h.count()).toBe(n);
});

test("12.4 excerpt words cannot be written or changed by hand", async () => {
  const h = await setup();
  chat(h, "conv", [said("person", "seats are the unit we bill")]);
  await h.ok("quote", "cite", "conv", "seats are the unit");
  const n = h.count();
  const add = await h.w("add", "cite:exnew", "--kind", "excerpt", "--title", "own words", "--parent", "cite");
  expect(add.code).not.toBe(0);
  expect(h.count()).toBe(n);
  const rt = await h.w("retitle", "cite:ex0", "new title");
  expect(rt.code).not.toBe(0);
  const ed = await h.w("edit", "cite:ex0", "--body", "changed");
  expect(ed.code).not.toBe(0);
  const pr = await h.w("propose", "cite:ex0", "--title", "other");
  expect(h.count()).toBe(n);
  void pr;
  expect(await h.ok("show", "cite:ex0")).toContain("seats are the unit");
  const say = await h.w("say", "cite:ex0", "a note");
  expect(say.code).toBe(0);
  expect(await h.ok("show", "cite:ex0")).toContain("a note");
  expect((await h.w("accept", "cite", "--actor", "you")).code).toBe(0);
  const ed2 = await h.w("edit", "cite:ex0", "--body", "changed again");
  expect(ed2.code).not.toBe(0);
  const rt2 = await h.w("retitle", "cite:ex0", "new title");
  expect(rt2.code).not.toBe(0);
  const show = await h.ok("show", "cite:ex0");
  expect(show).toContain("seats are the unit");
  expect(show).not.toContain("changed");
  expect(show).not.toContain("new title");
});

test("12.5 excerpt follows the fate of its citing card", async () => {
  const h = mk();
  await h.ok("add", "one", "--title", "Card one");
  await h.ok("add", "two", "--title", "Card two");
  chat(h, "conv", [said("person", "seats are the unit we bill", "t0", "s1"), said("agent", "invoices go out monthly", "t1", "s1")]);
  await h.ok("quote", "one", "conv", "seats are the unit");
  await h.ok("quote", "two", "conv", "invoices go out");
  await h.ok("discard", "one");
  expect((await h.w("show", "one")).code).not.toBe(0);
  expect((await h.w("show", "one:ex0")).code).not.toBe(0);
  expect((await h.w("accept", "two", "--actor", "you")).code).toBe(0);
  const card = await h.ok("show", "two");
  expect(card).not.toContain("proposed");
  const ex = await h.ok("show", "two:ex0");
  console.log(ex);
  expect(ex).not.toContain("proposed");
  expect(ex).toContain("invoices go out");
  const ev = h.events().find((e) => e.type === "excerpt.quoted" && e.payload.id === "two:ex0");
  expect(ev.payload).toMatchObject({ speaker: "agent", said_at: "t1", session: "s1", message: 1, start: 0, end: 15 });
});

test("67.1 quote from a session becomes a ghost excerpt", async () => {
  const h = mk();
  h.card("werk-excerpt", { title: "Excerpts" });
  chat(h, "sess", [said("user", "hi"), said("user", "Every quote in the imported map was written from memory")]);
  const r = await h.w("quote", "werk-excerpt", "sess", "written from memory");
  expect(r.code).toBe(0);
  const ex = await h.ok("show", "werk-excerpt:ex0");
  console.log(ex);
  expect(ex).toContain("proposed");
  const ev = h.events().at(-1);
  const msg = "Every quote in the imported map was written from memory";
  expect(ev.payload.speaker).toBe("user");
  expect(ev.payload.message).toBe(1);
  expect(ev.payload.session).toBe("sess-1");
  expect(ev.payload.start).toBe(msg.indexOf("written from memory"));
  expect(ev.payload.end).toBe(msg.length);
  expect(await h.ok("show", "werk-excerpt")).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("67.2 span in the transcript gives the quoted text", async () => {
  const h = mk();
  h.card("werk-excerpt", {});
  const msg = "Assistant says the reader must never guess at a quote.";
  const lines = [said("user", "q"), said("assistant", msg)];
  chat(h, "sess", lines);
  await h.ok("quote", "werk-excerpt", "sess", "must never guess");
  const ev = h.events().at(-1).payload;
  const line = lines[ev.message] as any;
  expect(line.text.slice(ev.start, ev.end)).toBe("must never guess");
  expect(line.speaker).toBe("assistant");
  expect(ev.speaker).toBe("assistant");
  const shown = await h.ok("show", "werk-excerpt:ex0");
  console.log(shown);
});

test("67.3 one changed character fails and changes nothing", async () => {
  const h = mk();
  h.card("c", {});
  chat(h, "sess", [said("user", "the tool never guesses")]);
  const n = h.count();
  const r = await h.w("quote", "c", "sess", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(h.count()).toBe(n);
  expect(await h.ok("show", "c")).not.toContain("ex0");
});

test("67.4 quote in two messages fails and names both", async () => {
  const h = mk();
  h.card("c", {});
  chat(h, "sess", [
    said("user", "a"), said("user", "b"), said("user", "c"),
    said("user", "it fails instead of guessing"), said("user", "d"), said("user", "e"), said("user", "f"),
    said("agent", "yes fails instead of guessing"),
  ]);
  const n = h.count();
  const r = await h.w("quote", "c", "sess", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("3");
  expect(r.err).toContain("7");
  expect(h.count()).toBe(n);
});

test("67.5 accepting a ghost excerpt makes it normal", async () => {
  const h = mk();
  h.card("c", {});
  chat(h, "sess", [said("user", "hello world words")]);
  await h.ok("quote", "c", "sess", "world words");
  expect(await h.ok("show", "c:ex0")).toContain("proposed");
  const r = await h.w("accept", "c:ex0", "--actor", "you");
  expect(r.code).toBe(0);
  const ex = await h.ok("show", "c:ex0");
  expect(ex).not.toContain("proposed");
  const c = await h.ok("show", "c");
  expect(c).toMatch(/supported_by\s+c:ex0/);
  expect(c).not.toContain("held");
});
