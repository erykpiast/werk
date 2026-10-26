// Held-out steps 12.1-12.5: werk quote turns a unique spoken quote into an excerpt ghost.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, type P } from "./lib.ts";

const line = (kind: string, text: string, speaker: string, at: string, session = "sess-1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function chat(p: P, name: string, lines: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

async function ghostCiting(p: P, id: string): Promise<void> {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  const r = await p.w("add", id, "--title", `Card ${id}`, "--parent", "root");
  expect(r.code).toBe(0);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = make();
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "conv", [
    line("tool_result", "listing files", "agent", "2026-10-01T10:00:00Z"),
    line("spoken", "how do we store chats?", "person", "2026-10-01T10:00:01Z"),
    line("spoken", said, "agent", "2026-10-01T10:00:02Z"),
  ]);
  await ghostCiting(p, "store");
  const before = p.lines().length;
  const r = await p.w("quote", "store", "conv", "one log per conversation");
  expect(r.code).toBe(0);
  const after = p.events();
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1);
  expect(ev.type).toBe("excerpt.quoted");
  const id = ev.payload.id as string;
  const show = await p.w("show", id);
  expect(show.out).toContain("proposed");
  expect(show.out).toContain("one log per conversation");
  expect(show.out).toContain("speaker: agent");
  expect(show.out).toContain("2026-10-01T10:00:02Z");
  expect(show.out).toContain("sess-1");
  expect(show.out).toMatch(/supported_by\s+store/);
  const start = said.indexOf("one log per conversation");
  expect(show.out).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // The step: the message position is 3, because the hidden tool result line counts.
  expect(show.out).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = make();
  chat(p, "conv", [
    line("spoken", "ship the reader first", "person", "t0"),
    line("spoken", "ok, ship the reader first then", "agent", "t1"),
    line("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ghostCiting(p, "plan");
  const before = p.lines().length;
  const a = await p.w("quote", "plan", "conv", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.w("quote", "plan", "conv", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 (matches|times) in (one )?message/);
  const c = await p.w("quote", "plan", "conv", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(p.lines().length).toBe(before);
  const show = await p.w("show", "plan");
  expect(show.out).not.toContain("supported_by");
  expect(p.events().some((e) => e.type === "excerpt.quoted")).toBe(false);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = make();
  chat(p, "conv", [
    line("spoken", "please run the job", "person", "t0"),
    line("tool_call", "run job; expect exit code 137", "agent", "t1"),
    line("tool_result", "exit code 137 from the runner", "agent", "t2"),
    line("tooling", "note: exit code 137 seen", "agent", "t3"),
    line("spoken", "the job failed", "agent", "t4"),
  ]);
  await ghostCiting(p, "job");
  const before = p.lines().length;
  const r = await p.w("quote", "job", "conv", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(p.lines().length).toBe(before);
  expect(p.events().some((e) => e.type === "excerpt.quoted")).toBe(false);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = make();
  chat(p, "conv", [line("spoken", "the excerpt words are fixed", "person", "t0")]);
  await ghostCiting(p, "cite");
  expect((await p.w("quote", "cite", "conv", "words are fixed")).code).toBe(0);
  const ex = "cite:ex0";
  let n = p.lines().length;
  const add = await p.w("add", "cite:ex9", "--kind", "excerpt", "--title", "my own words");
  expect(add.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const retitle = await p.w("retitle", ex, "other words");
  expect(retitle.code).not.toBe(0);
  const edit = await p.w("edit", ex, "--body", "other words");
  expect(edit.code).not.toBe(0);
  const propose = await p.w("propose", ex, "--title", "other words");
  expect(propose.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect((await p.w("show", ex)).out).toContain("words are fixed");
  const say = await p.w("say", ex, "a note on the excerpt");
  expect(say.code).toBe(0);
  expect(p.events().at(-1)).toMatchObject({ type: "note.added", payload: { id: ex, text: "a note on the excerpt" } });
  expect((await p.w("accept", "cite", "--actor", "you")).code).toBe(0);
  n = p.lines().length;
  const edit2 = await p.w("edit", ex, "--body", "other words");
  const propose2 = await p.w("propose", ex, "--title", "other words");
  const retitle2 = await p.w("retitle", ex, "other words");
  expect(edit2.code).not.toBe(0);
  expect(propose2.code).not.toBe(0);
  expect(retitle2.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  const show = await p.w("show", ex);
  expect(show.out).toContain("words are fixed");
  expect(show.out).not.toContain("other words");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = make();
  chat(p, "conv", [
    line("spoken", "first quoted sentence here", "person", "2026-10-01T10:00:00Z"),
    line("spoken", "second quoted sentence here", "agent", "2026-10-01T10:00:01Z"),
  ]);
  await ghostCiting(p, "one");
  expect((await p.w("add", "two", "--title", "Card two", "--parent", "root")).code).toBe(0);
  expect((await p.w("quote", "one", "conv", "first quoted")).code).toBe(0);
  expect((await p.w("quote", "two", "conv", "second quoted")).code).toBe(0);
  expect((await p.w("discard", "one")).code).toBe(0);
  expect((await p.w("show", "one")).code).not.toBe(0);
  expect((await p.w("show", "one:ex0")).code).not.toBe(0);
  expect((await p.w("accept", "two", "--actor", "you")).code).toBe(0);
  const card = await p.w("show", "two");
  expect(card.out.split("\n")[0]).not.toContain("proposed");
  const ex = await p.w("show", "two:ex0");
  expect(ex.out.split("\n")[0]).not.toContain("proposed");
  for (const part of [
    "second quoted",
    "speaker: agent",
    "2026-10-01T10:00:01Z",
    "session: sess-1",
    "message: 1",
    "span: 0..13",
  ])
    expect(ex.out).toContain(part);
});
