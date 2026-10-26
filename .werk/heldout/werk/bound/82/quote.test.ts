import { expect, test } from "bun:test";
import { all, card, chat, events, freshProject, logLines, logText, root, seed, w } from "./helpers.ts";

const dec = { status: "decided", who: "me" };

test("[06.1] a new excerpt for a decided card stages as a ghost", async () => {
  const p = freshProject();
  root(p);
  card(p, "c", { title: "C words", why: "C why", ...dec });
  chat(p, "talk", [{ kind: "spoken", text: "the card holds because of this" }]);
  const before = all(await w(p, "show", "c"));
  const r = await w(p, "quote", "c", "talk", "holds because");
  expect(r.code, all(r)).toBe(0);
  expect(all(r)).toContain("proposed");
  expect(all(r)).not.toMatch(/\badded\b/);
  const ex = all(await w(p, "show", "c:ex0"));
  expect(ex).toContain("proposed");
  expect(ex).toMatch(/supported_by\s+c .*\(held\)|supported_by.*held/);
  const c = all(await w(p, "show", "c"));
  expect(c).toContain("[decided]");
  expect(c).toContain("C words");
  expect(c).toContain("C why");
  expect(before.split("\n")[0]).toBe(c.split("\n")[0]);
});

test("[12.1] a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "cite", "--title", "Citing card");
  chat(p, "conv", [
    { kind: "tool_result", text: "ls output one log per conversation", speaker: "agent", at: "t0" },
    { kind: "spoken", text: "so what do we keep?", speaker: "person", at: "t1" },
    { kind: "spoken", text: "we keep one log per conversation and never rewrite it", speaker: "agent", at: "2026-02-02T10:00:00Z", session: "sess-xyz" },
  ]);
  const n = logLines(p).length;
  const r = await w(p, "quote", "cite", "conv", "one log per conversation");
  expect(r.code, all(r)).toBe(0);
  expect(logLines(p).length).toBe(n + 1);
  const ev = events(p).at(-1);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("cite");
  expect(ev.payload.title).toBe("one log per conversation");
  expect(ev.payload.speaker).toBe("agent");
  expect(ev.payload.said_at).toBe("2026-02-02T10:00:00Z");
  expect(ev.payload.session).toBe("sess-xyz");
  expect(ev.payload.message).toBe(3);
  const text = "we keep one log per conversation and never rewrite it";
  expect(ev.payload.start).toBe(text.indexOf("one log"));
  expect(ev.payload.end).toBe(text.indexOf("one log") + "one log per conversation".length);
});

test("[12.2] a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "cite", "--title", "Citing card");
  chat(p, "conv", [
    { kind: "spoken", text: "ship the reader first", speaker: "person" },
    { kind: "spoken", text: "retry, then retry again", speaker: "person" },
    { kind: "spoken", text: "ship the reader first", speaker: "agent" },
  ]);
  const n = logLines(p).length;
  const a = await w(p, "quote", "cite", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/2 messages/);
  const b = await w(p, "quote", "cite", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/2 (times|matches)/);
  expect(all(b)).toMatch(/in message|one message/);
  const c = await w(p, "quote", "cite", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(all(c)).toMatch(/no (exact )?match/);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "cite"))).not.toContain("ex0");
});

test("[12.3] text that appears only in tool output is never quotable", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "cite", "--title", "Citing card");
  chat(p, "conv", [
    { kind: "tool_result", text: "exit code 137 from the runner" },
    { kind: "tool_call", text: "run exit code 137" },
    { kind: "tooling", text: "note: exit code 137" },
    { kind: "spoken", text: "the runner died" },
  ]);
  const n = logLines(p).length;
  const r = await w(p, "quote", "cite", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/no (exact )?match/);
  expect(logLines(p).length).toBe(n);
});

test("[12.4] an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "cite", "--title", "Citing card");
  chat(p, "conv", [{ kind: "spoken", text: "we keep one log per conversation" }]);
  await w(p, "quote", "cite", "conv", "one log per conversation");
  let n = logLines(p).length;
  const add = await w(p, "add", "cite:ex9", "--kind", "excerpt", "--title", "made up words");
  expect(add.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  const t = await w(p, "retitle", "cite:ex0", "different");
  expect(t.code).not.toBe(0);
  const e = await w(p, "edit", "cite:ex0", "--body", "different");
  expect(e.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "cite:ex0"))).toContain("one log per conversation");
  const say = await w(p, "say", "cite:ex0", "a note");
  expect(say.code, all(say)).toBe(0);
  expect(logText(p)).toContain("a note");
  expect((await w(p, "accept", "cite", "--actor", "you")).code).toBe(0);
  n = logLines(p).length;
  const again = await w(p, "edit", "cite:ex0", "--body", "different");
  expect(again.code).not.toBe(0);
  const again2 = await w(p, "retitle", "cite:ex0", "different");
  expect(again2.code).not.toBe(0);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "cite:ex0"))).toContain("one log per conversation");
});

test("[12.5] the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  root(p);
  await w(p, "add", "one", "--title", "One");
  await w(p, "add", "two", "--title", "Two");
  chat(p, "conv", [{ kind: "spoken", text: "alpha beta gamma delta" }]);
  await w(p, "quote", "one", "conv", "alpha beta");
  await w(p, "quote", "two", "conv", "gamma delta");
  expect((await w(p, "discard", "one")).code).toBe(0);
  expect(all(await w(p, "show", "one"))).toMatch(/no node/);
  expect(all(await w(p, "show", "one:ex0"))).toMatch(/no node/);
  expect((await w(p, "accept", "two", "--actor", "you")).code).toBe(0);
  const s = all(await w(p, "show", "two"));
  expect(s).not.toContain("proposed");
  const x = all(await w(p, "show", "two:ex0"));
  expect(x).not.toContain("proposed");
  for (const t of ["gamma delta", "speaker: person", "said at: t", "session: sess1", "message: 0", "span: 11..22"]) {
    expect(x).toContain(t);
  }
});

test("[67.1] a quote found once in a transcript becomes a ghost excerpt on the citing card", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-excerpt", { title: "Excerpt", ...dec });
  chat(p, "s1", [
    { kind: "spoken", text: "hello", speaker: "agent" },
    { kind: "spoken", text: "Every quote in the imported map was written from memory", speaker: "user" },
  ]);
  const r = await w(p, "quote", "#werk-excerpt", "s1", "written from memory");
  expect(r.code, all(r)).toBe(0);
  const x = all(await w(p, "show", "werk-excerpt:ex0"));
  expect(x).toContain("proposed");
  expect(x).toContain("session: sess1");
  expect(x).toContain("message: 1");
  expect(x).toContain("speaker: user");
  const full = "Every quote in the imported map was written from memory";
  const st = full.indexOf("written from memory");
  expect(x).toContain(`span: ${st}..${st + 19}`);
  expect(all(await w(p, "show", "werk-excerpt"))).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("[67.2] the excerpt lets the person find the quote again in the transcript", async () => {
  const p = freshProject();
  root(p);
  card(p, "werk-excerpt", { title: "Excerpt", ...dec });
  chat(p, "s1", [
    { kind: "spoken", text: "first", speaker: "user" },
    { kind: "spoken", text: "The tool never guesses at all", speaker: "assistant" },
  ]);
  await w(p, "quote", "werk-excerpt", "s1", "never guesses");
  const x = all(await w(p, "show", "werk-excerpt:ex0"));
  const m = /message: (\d+)/.exec(x);
  const sp = /span: (\d+)\.\.(\d+)/.exec(x);
  expect(m && sp).toBeTruthy();
  const lines = (await Bun.file(`${p.dir}/.werk/chats/s1.jsonl`).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const line = lines[Number(m?.[1])];
  expect(line.text.slice(Number(sp?.[1]), Number(sp?.[2]))).toBe("never guesses");
  expect(line.speaker).toBe("assistant");
  expect(x).toContain("speaker: assistant");
});

test("[67.3] a quote with one changed character fails and changes nothing", async () => {
  const p = freshProject();
  root(p);
  card(p, "c", { title: "C", ...dec });
  chat(p, "s1", [{ kind: "spoken", text: "the tool never guesses" }]);
  const n = logLines(p).length;
  const r = await w(p, "quote", "c", "s1", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/no exact match/);
  expect(logLines(p).length).toBe(n);
  expect(all(await w(p, "show", "c"))).not.toContain("ex0");
});

test("[67.4] a quote that occurs in two messages fails and names both", async () => {
  const p = freshProject();
  root(p);
  card(p, "c", { title: "C", ...dec });
  const lines = Array.from({ length: 8 }, (_, i) => ({ kind: "spoken", text: i === 3 || i === 7 ? "it fails instead of guessing" : `filler ${i}` }));
  chat(p, "s1", lines);
  const n = logLines(p).length;
  const r = await w(p, "quote", "c", "s1", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(all(r)).toMatch(/\b3\b/);
  expect(all(r)).toMatch(/\b7\b/);
  expect(logLines(p).length).toBe(n);
});

test("[67.5] a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = freshProject();
  root(p);
  card(p, "c", { title: "C", ...dec });
  chat(p, "s1", [{ kind: "spoken", text: "some words here" }]);
  await w(p, "quote", "c", "s1", "words");
  const r = await w(p, "accept", "c:ex0", "--actor", "you");
  expect(r.code, all(r)).toBe(0);
  expect(all(await w(p, "show", "c:ex0"))).not.toContain("proposed");
  expect(all(await w(p, "show", "c"))).toMatch(/supported_by\s+c:ex0/);
  expect(all(await w(p, "show", "c"))).not.toContain("held");
});
