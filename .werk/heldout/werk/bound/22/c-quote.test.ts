import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, type P, project } from "./cli.ts";
afterEach(cleanupAll);

type L = { speaker: string; kind: string; text: string; at?: string; session?: string };
function chat(p: P, name: string, lines: L[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    lines.map((l, i) => JSON.stringify({ at: `2026-10-01T00:00:0${i}.000Z`, session: "sess-1", ...l })).join("\n") + "\n",
  );
}
const ok = (p: P, ...a: string[]) => {
  const r = p.werk(...a);
  if (r.code !== 0) throw new Error(`werk ${a.join(" ")} -> ${r.code}: ${r.all}`);
  return r;
};

test("12.1 unique quote becomes excerpt ghost", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "conv", [
    { speaker: "agent", kind: "tool_result", text: "ls output" },
    { speaker: "person", kind: "spoken", text: "how do we store chats?" },
    { speaker: "agent", kind: "spoken", text: "we keep one log per conversation and never rewrite it", at: "2026-10-01T09:00:00.000Z" },
  ]);
  ok(p, "add", "logs", "--title", "Logs per conversation", "--parent", "root");
  const before = p.lines().length;
  const r = p.werk("quote", "logs", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  const ev = p.events();
  expect(ev.length).toBe(before + 1);
  const e = ev.at(-1)!;
  expect(e.type).toBe("excerpt.quoted");
  expect(e.payload.card).toBe("logs");
  const id = e.payload.id as string;
  const card = ok(p, "show", "logs").out;
  expect(card).toMatch(new RegExp(`supported_by\\s+${id.replace(":", "\\:")}.*one log per conversation.*held`));
  const ex = ok(p, "show", id).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("2026-10-01T09:00:00.000Z");
  expect(ex).toContain("sess-1");
  const text = "we keep one log per conversation and never rewrite it";
  const s = text.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${s}..${s + "one log per conversation".length}`);
  // step text: message position is 3
  expect(ex).toContain("message: 3");
});

test("12.2 non-unique quote fails and writes nothing", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "c2", [
    { speaker: "person", kind: "spoken", text: "ship the reader first" },
    { speaker: "agent", kind: "spoken", text: "ok, ship the reader first" },
    { speaker: "person", kind: "spoken", text: "retry, then retry again" },
  ]);
  ok(p, "add", "g", "--title", "G", "--parent", "root");
  const before = p.raw();
  const a = p.werk("quote", "g", "c2", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.all).toContain("2 messages");
  const b = p.werk("quote", "g", "c2", "retry");
  expect(b.code).not.toBe(0);
  expect(b.all).toMatch(/2 times in message|2 matches/);
  const c = p.werk("quote", "g", "c2", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.all).toMatch(/no (exact )?match/);
  expect(p.raw()).toBe(before);
  expect(ok(p, "show", "g").out).not.toContain("supported_by");
});

test("12.3 tool-only text is not quotable", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "c3", [
    { speaker: "person", kind: "spoken", text: "why did it die?" },
    { speaker: "agent", kind: "tool_call", text: "tail runner.log | grep 'exit code 137'" },
    { speaker: "agent", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "werk", kind: "tooling", text: "note: exit code 137 seen" },
    { speaker: "agent", kind: "spoken", text: "the runner ran out of memory" },
  ]);
  ok(p, "add", "g", "--title", "G", "--parent", "root");
  const before = p.raw();
  const r = p.werk("quote", "g", "c3", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/no (exact )?match/);
  expect(p.raw()).toBe(before);
});

test("12.4 excerpt words cannot be written by hand", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "c4", [{ speaker: "person", kind: "spoken", text: "keep the quote exact" }]);
  ok(p, "add", "cite", "--title", "Cite", "--parent", "root");
  ok(p, "quote", "cite", "c4", "quote exact");
  const id = "cite:ex0";
  let before = p.raw();
  const add = p.werk("add", "cite:ex9", "--kind", "excerpt", "--title", "my own words");
  expect(add.code).not.toBe(0);
  expect(p.raw()).toBe(before);
  const tries = [
    ["retitle", id, "changed words"],
    ["edit", id, "--body", "changed words"],
    ["propose", id, "--title", "changed words"],
  ];
  for (const t of tries) {
    const r = p.werk(...t);
    expect(r.code, t.join(" ")).not.toBe(0);
  }
  expect(p.raw()).toBe(before);
  expect(ok(p, "show", id).out).toContain("quote exact");
  ok(p, "say", id, "a note on the excerpt");
  expect(p.events().at(-1)?.type).toBe("note.added");
  expect(ok(p, "show", id).out).toContain("a note on the excerpt");
  ok(p, "accept", "cite", "--actor", "you");
  before = p.raw();
  for (const t of tries) expect(p.werk(...t).code, t.join(" ")).not.toBe(0);
  expect(p.raw()).toBe(before);
  const show = ok(p, "show", id).out;
  expect(show).toContain("quote exact");
  expect(show).not.toContain("changed words");
});

test("12.5 excerpt follows citing card", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "c5", [
    { speaker: "person", kind: "spoken", text: "alpha words here" },
    { speaker: "agent", kind: "spoken", text: "beta words there" },
  ]);
  ok(p, "add", "one", "--title", "One", "--parent", "root");
  ok(p, "add", "two", "--title", "Two", "--parent", "root");
  ok(p, "quote", "one", "c5", "alpha words");
  ok(p, "quote", "two", "c5", "beta words");
  const ptr = ok(p, "show", "two:ex0").out.split("\n").slice(1).join("\n");
  ok(p, "discard", "one");
  expect(p.werk("show", "one").code).not.toBe(0);
  expect(p.werk("show", "one:ex0").code).not.toBe(0);
  ok(p, "accept", "two", "--actor", "you");
  expect(ok(p, "show", "two").out.split("\n")[0]).not.toContain("proposed");
  const ex = ok(p, "show", "two:ex0").out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const k of ["beta words", "speaker: agent", "said at:", "session: sess-1", "message: 1", "span: 0..10"])
    expect(ex).toContain(k);
  expect(ex.split("\n").slice(1, 8).join("\n")).toBe(ptr.split("\n").slice(0, 7).join("\n"));
});

test("67.1 quote becomes ghost excerpt with pointer", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-excerpt", "Excerpts", { parent: "root" });
  const said = "Every quote in the imported map was written from memory";
  chat(p, "rec", [
    { speaker: "assistant", kind: "spoken", text: "hello" },
    { speaker: "user", kind: "spoken", text: said },
  ]);
  const r = p.werk("quote", "#werk-excerpt", "rec", "written from memory");
  expect(r.code).toBe(0);
  const id = p.events().at(-1)?.payload.id as string;
  const ex = ok(p, "show", id).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  const s = said.indexOf("written from memory");
  for (const k of ["session: sess-1", "message: 1", "speaker: user", `span: ${s}..${s + 19}`]) expect(ex).toContain(k);
  expect(ok(p, "show", "werk-excerpt").out).toMatch(/supported_by\s+werk-excerpt:ex0/);
});

test("67.2 excerpt pointer finds the quote again", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-excerpt", "Excerpts", { parent: "root" });
  const lines = [
    { speaker: "user", kind: "spoken", text: "what does quote do?" },
    { speaker: "assistant", kind: "tool_call", text: "read" },
    { speaker: "assistant", kind: "spoken", text: "It cuts the words verbatim from the transcript." },
  ];
  chat(p, "rec", lines);
  ok(p, "quote", "werk-excerpt", "rec", "verbatim from the transcript");
  const ex = ok(p, "show", "werk-excerpt:ex0").out;
  const m = Number(/message: (\d+)/.exec(ex)?.[1]);
  const [, a, b] = /span: (\d+)\.\.(\d+)/.exec(ex)!.map(Number) as number[];
  const sp = /speaker: (\S+)/.exec(ex)?.[1];
  const line = lines[m]!;
  expect(line.text.slice(a, b)).toBe("verbatim from the transcript");
  expect(line.speaker).toBe("assistant");
  expect(sp).toBe("assistant");
});

test("67.3 one changed character fails", () => {
  const p = project();
  p.card("root", "Root");
  chat(p, "rec", [{ speaker: "user", kind: "spoken", text: "the tool never guesses" }]);
  const n = p.lines().length;
  const r = p.werk("quote", "root", "rec", "the tool never gueses");
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/no exact match/);
  expect(p.lines().length).toBe(n);
  expect(ok(p, "show", "root").out).not.toContain("supported_by");
});

test("67.4 quote in two messages names both", () => {
  const p = project();
  p.card("root", "Root");
  const ls: L[] = [];
  for (let i = 0; i < 9; i++) ls.push({ speaker: i % 2 ? "assistant" : "user", kind: "spoken", text: `line ${i}` });
  ls[3] = { speaker: "assistant", kind: "spoken", text: "it fails instead of guessing" };
  ls[7] = { speaker: "assistant", kind: "spoken", text: "again: fails instead of guessing." };
  chat(p, "rec", ls);
  const before = p.raw();
  const r = p.werk("quote", "root", "rec", "fails instead of guessing");
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/\b3\b/);
  expect(r.all).toMatch(/\b7\b/);
  expect(p.raw()).toBe(before);
});

test("67.5 ghost excerpt accepted like other ghosts", () => {
  const p = project();
  p.card("root", "Root");
  p.card("werk-excerpt", "Excerpts", { parent: "root" });
  chat(p, "rec", [{ speaker: "user", kind: "spoken", text: "accept me please" }]);
  ok(p, "quote", "werk-excerpt", "rec", "accept me");
  const r = p.werk("accept", "werk-excerpt:ex0", "--actor", "you");
  expect(r.code, r.all).toBe(0);
  expect(ok(p, "show", "werk-excerpt:ex0").out.split("\n")[0]).not.toContain("proposed");
  const card = ok(p, "show", "werk-excerpt").out;
  expect(card).toMatch(/supported_by\s+werk-excerpt:ex0\s+accept me/);
  expect(card).not.toMatch(/supported_by\s+werk-excerpt:ex0.*(held|ghost)/);
});
