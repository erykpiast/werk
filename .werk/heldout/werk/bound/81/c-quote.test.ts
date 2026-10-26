import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { proj } from "./c-lib.ts";

const sp = (speaker: string, text: string, kind = "spoken", at = "t0") => ({ speaker, at, session: "s1", kind, text });

test("12.1 unique quote becomes an excerpt ghost", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.seed("node.proposed", { id: "cite", kind: "card", title: "Cite", parent: "root" });
  p.chat("conv", [
    sp("tool", "result of a tool", "tool_result"),
    sp("person", "please decide"),
    sp("agent", "we keep one log per conversation and never rewrite it", "spoken", "t9"),
  ]);
  const n = p.lines().length;
  const r = p.werk("quote", "cite", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  expect(p.lines().length).toBe(n + 1);
  const ev = JSON.parse(p.lines().at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("cite");
  const show = p.werk("show", "cite:ex0").out;
  expect(show).toContain("one log per conversation");
  expect(show).toContain("speaker: agent");
  expect(show).toContain("said at: t9");
  expect(show).toContain("session: s1");
  expect(show).toContain("ghost");
  expect(p.werk("show", "cite").out).toMatch(/supported_by\s+cite:ex0/);
  const text = "we keep one log per conversation and never rewrite it";
  const start = text.indexOf("one log per conversation");
  expect(show).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // the step says the position is 3 for a log of: tool result, person, agent
  expect(show).toContain("message: 3");
});

test("12.2 non-unique quotes fail and write nothing", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.seed("node.proposed", { id: "cite", kind: "card", title: "Cite", parent: "root" });
  p.chat("conv", [sp("person", "ship the reader first"), sp("agent", "ship the reader first"), sp("person", "retry, then retry again")]);
  const n = p.lines().length;
  const a = p.werk("quote", "cite", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = p.werk("quote", "cite", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 (times|matches)/);
  const c = p.werk("quote", "cite", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(p.lines().length).toBe(n);
  expect(p.werk("show", "cite:ex0").code).not.toBe(0);
});

test("12.3 tool output is never quotable", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.seed("node.proposed", { id: "cite", kind: "card", title: "Cite", parent: "root" });
  p.chat("conv", [
    sp("tool", "exit code 137 from the runner", "tool_result"),
    sp("agent", "Bash exit code 137", "tool_call"),
    sp("system", "note: exit code 137", "tooling"),
    sp("person", "ok"),
  ]);
  const n = p.lines().length;
  const r = p.werk("quote", "cite", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(p.lines().length).toBe(n);
});

test("12.4 excerpt words cannot be written or changed by hand", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.werk("add", "cite", "--title", "Cite card", "--parent", "root");
  p.chat("conv", [sp("person", "seats are the unit we bill")]);
  expect(p.werk("quote", "cite", "conv", "seats are the unit").code).toBe(0);
  let n = p.lines().length;
  const add = p.werk("add", "cite:ex9", "--kind", "excerpt", "--title", "my words");
  expect(add.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const rt = p.werk("retitle", "cite:ex0", "other words");
  expect(rt.code).not.toBe(0);
  const ed = p.werk("edit", "cite:ex0", "--body", "other");
  expect(ed.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect(p.werk("show", "cite:ex0").out).toContain("seats are the unit");
  expect(p.werk("say", "cite:ex0", "a note").code).toBe(0);
  expect(p.werk("show", "cite:ex0").out).toContain("a note");
  expect(p.werk("accept", "cite", "--actor", "you").code).toBe(0);
  n = p.lines().length;
  expect(p.werk("edit", "cite:ex0", "--body", "again").code).not.toBe(0);
  expect(p.werk("retitle", "cite:ex0", "again").code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const s = p.werk("show", "cite:ex0").out;
  expect(s).toContain("seats are the unit");
  expect(s).not.toContain("again");
});

test("12.5 excerpt follows citing card", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.werk("add", "one", "--title", "One", "--parent", "root");
  p.werk("add", "two", "--title", "Two", "--parent", "root");
  p.chat("conv", [sp("person", "alpha beta gamma"), sp("agent", "delta epsilon zeta", "spoken", "t5")]);
  expect(p.werk("quote", "one", "conv", "alpha beta").code).toBe(0);
  expect(p.werk("quote", "two", "conv", "epsilon").code).toBe(0);
  expect(p.werk("discard", "one").code).toBe(0);
  expect(p.werk("show", "one").code).not.toBe(0);
  expect(p.werk("show", "one:ex0").code).not.toBe(0);
  expect(p.werk("accept", "two", "--actor", "you").code).toBe(0);
  expect(p.werk("show", "two").out).not.toContain("ghost");
  const s = p.werk("show", "two:ex0").out;
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("proposed");
  for (const f of ["epsilon", "speaker: agent", "said at: t5", "session: s1", "message: 1", "span: 6..13"]) expect(s).toContain(f);
});

test("67.1 quote from a user message is a ghost excerpt", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("werk-excerpt", { title: "Excerpt" });
  const text = "Every quote in the imported map was written from memory";
  p.chat("sess", [sp("assistant", "hi"), sp("user", text)]);
  const r = p.werk("quote", "#werk-excerpt", "sess", "written from memory");
  expect(r.code).toBe(0);
  const s = p.werk("show", "werk-excerpt:ex0").out;
  const start = text.indexOf("written from memory");
  for (const f of ["proposed", "session: s1", "message: 1", "speaker: user", `span: ${start}..${start + 19}`]) expect(s).toContain(f);
  expect(p.werk("show", "werk-excerpt").out).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("67.2 span finds the quote again", () => {
  const p = proj();
  p.card("werk-excerpt", { title: "Excerpt" });
  const text = "I will quote exactly this sentence for you";
  p.chat("sess", [sp("user", "q"), sp("assistant", text)]);
  expect(p.werk("quote", "werk-excerpt", "sess", "exactly this sentence").code).toBe(0);
  const s = p.werk("show", "werk-excerpt:ex0").out;
  const num = (k: string) => Number(new RegExp(`${k}: (\\d+)`).exec(s)?.[1]);
  const [start, end] = (/span: (\d+)\.\.(\d+)/.exec(s) ?? []).slice(1).map(Number) as [number, number];
  const lines = readFileSync(join(p.dir, ".werk", "chats", "sess.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const msg = lines[num("message")];
  expect(msg.text.slice(start, end)).toBe("exactly this sentence");
  expect(msg.speaker).toBe("assistant");
  expect(s).toContain("speaker: assistant");
});

test("67.3 one changed character fails", () => {
  const p = proj();
  p.card("c", { title: "C" });
  p.chat("sess", [sp("user", "the tool never guesses")]);
  const n = p.lines().length;
  const r = p.werk("quote", "c", "sess", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(p.lines().length).toBe(n);
  expect(p.werk("show", "c:ex0").code).not.toBe(0);
});

test("67.4 two messages fail and name both", () => {
  const p = proj();
  p.card("c", { title: "C" });
  const msgs = Array.from({ length: 8 }, (_, i) => sp(i % 2 ? "assistant" : "user", `filler ${i}`));
  msgs[3] = sp("assistant", "it fails instead of guessing");
  msgs[7] = sp("assistant", "again fails instead of guessing");
  p.chat("sess", msgs);
  const n = p.lines().length;
  const r = p.werk("quote", "c", "sess", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(p.lines().length).toBe(n);
  expect(p.werk("show", "c:ex0").code).not.toBe(0);
});

test("67.5 ghost excerpt accepted like any ghost", () => {
  const p = proj();
  p.card("c", { title: "C" });
  p.chat("sess", [sp("user", "a quoted line of words")]);
  expect(p.werk("quote", "c", "sess", "quoted line").code).toBe(0);
  const a = p.werk("accept", "c:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  const s = p.werk("show", "c:ex0").out;
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("proposed");
  const c = p.werk("show", "c").out;
  expect(c).toMatch(/supported_by\s+c:ex0/);
  expect(c).not.toContain("held");
});
