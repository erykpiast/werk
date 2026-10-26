import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Held, held } from "./helpers.ts";

type Line = { speaker: string; at: string; session: string; kind: string; text: string };

function chat(h: Held, name: string, lines: Line[]): void {
  mkdirSync(join(h.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(h.dir, ".werk", "chats", `${name}.jsonl`),
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
}

const said = (speaker: string, text: string, at = "2026-03-01T09:00:00Z"): Line => ({
  speaker,
  at,
  session: "sess-42",
  kind: "spoken",
  text,
});

async function ghostCard(h: Held, id: string, title: string): Promise<void> {
  h.seed("node.added", { id: "root", kind: "card", title: "Root" });
  expect((await h.w("add", id, "--title", title, "--parent", "root")).code).toBe(0);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const h = held();
  chat(h, "logs", [
    { speaker: "tool", at: "2026-03-01T08:59:00Z", session: "sess-42", kind: "tool_result", text: "ok" },
    said("person", "How should the log work?", "2026-03-01T08:59:30Z"),
    said("agent", "we keep one log per conversation and never rewrite it", "2026-03-01T09:00:00Z"),
  ]);
  await ghostCard(h, "log-shape", "One log per conversation");
  const before = h.events().length;

  const run = await h.w("quote", "log-shape", "logs", "one log per conversation");
  expect(run.code).toBe(0);

  const fresh = h.events().slice(before);
  expect(fresh.length).toBe(1);
  expect(fresh[0]?.type).toBe("excerpt.quoted");
  expect(fresh[0]?.payload.card).toBe("log-shape");

  const cardShow = (await h.w("show", "log-shape")).out;
  const sayLines = cardShow.split("\n").slice(cardShow.split("\n").indexOf("Say") + 1);
  expect(sayLines.filter((line) => line.includes("one log per conversation")).length).toBe(1);

  const ex = await h.w("show", "log-shape:ex0");
  expect(ex.code).toBe(0);
  expect(ex.out.split("\n")[0]).toContain("proposed");
  expect(ex.out).toMatch(/<- supported_by\s+log-shape/);
  expect(ex.out).toContain("one log per conversation");
  expect(ex.out).toContain("speaker: agent");
  expect(ex.out).toContain("said at: 2026-03-01T09:00:00Z");
  expect(ex.out).toContain("session: sess-42");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex.out).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(ex.out).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const h = held();
  chat(h, "plan", [
    said("person", "ship the reader first"),
    said("agent", "Agreed: ship the reader first"),
    said("person", "retry, then retry again"),
  ]);
  await ghostCard(h, "plan-card", "Reader first");
  const before = h.events().length;

  const two = await h.w("quote", "plan-card", "plan", "ship the reader first");
  expect(two.code).not.toBe(0);
  expect(two.err).toMatch(/2 messages/);

  const twice = await h.w("quote", "plan-card", "plan", "retry");
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message/);

  const none = await h.w("quote", "plan-card", "plan", "a sentence nobody said");
  expect(none.code).not.toBe(0);
  expect(none.err).toMatch(/no (exact )?match/);

  expect(h.events().length).toBe(before);
  const show = (await h.w("show", "plan-card")).out;
  expect(show).not.toContain("Say");
  expect(show).not.toContain("supported_by");
  expect((await h.w("show", "plan-card:ex0")).code).not.toBe(0);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const h = held();
  chat(h, "runner", [
    { speaker: "tool", at: "t1", session: "s", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", at: "t2", session: "s", kind: "tool_call", text: "rerun; expect exit code 137" },
    { speaker: "werk", at: "t3", session: "s", kind: "tooling", text: "note: exit code 137 seen" },
    said("person", "why did the runner die?"),
  ]);
  await ghostCard(h, "runner-card", "Runner memory");
  const before = h.events().length;
  const run = await h.w("quote", "runner-card", "runner", "exit code 137");
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/no (exact )?match/);
  expect(h.events().length).toBe(before);
  expect((await h.w("show", "runner-card:ex0")).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const h = held();
  chat(h, "talk", [said("person", "excerpts are verbatim")]);
  await ghostCard(h, "verbatim", "Excerpts are verbatim");
  expect((await h.w("quote", "verbatim", "talk", "excerpts are verbatim")).code).toBe(0);
  const ex = "verbatim:ex0";

  let before = h.events().length;
  const plain = await h.w("add", "verbatim:ex1", "--kind", "excerpt", "--title", "words I made up");
  expect(plain.code).not.toBe(0);
  expect(h.events().length).toBe(before);
  expect((await h.w("show", "verbatim:ex1")).code).not.toBe(0);

  for (const args of [
    ["propose", ex, "--title", "other words"],
    ["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other body" }])],
  ]) {
    before = h.events().length;
    const run = await h.w(...args);
    expect(run.code).not.toBe(0);
    expect(h.events().length).toBe(before);
    expect((await h.w("show", ex)).out).toContain("excerpts are verbatim");
  }

  const say = await h.w("say", ex, "this excerpt is the reason");
  expect(say.code).toBe(0);
  expect((await h.w("inbox")).out + JSON.stringify(h.events().at(-1))).toContain("this excerpt is the reason");
  expect(h.events().at(-1)?.payload.id).toBe(ex);

  expect((await h.w("accept", "verbatim", "--actor", "you")).code).toBe(0);
  before = h.events().length;
  const edit = await h.w("propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other body" }]));
  expect(edit.code).not.toBe(0);
  expect(h.events().length).toBe(before);
  const show = (await h.w("show", ex)).out;
  expect(show).toContain("excerpts are verbatim");
  expect(show).not.toContain("other body");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const h = held();
  chat(h, "both", [said("person", "the first reason"), said("agent", "the second reason", "2026-03-01T09:05:00Z")]);
  h.seed("node.added", { id: "root", kind: "card", title: "Root" });
  expect((await h.w("add", "first", "--title", "First", "--parent", "root")).code).toBe(0);
  expect((await h.w("add", "second", "--title", "Second", "--parent", "root")).code).toBe(0);
  expect((await h.w("quote", "first", "both", "the first reason")).code).toBe(0);
  expect((await h.w("quote", "second", "both", "the second reason")).code).toBe(0);

  expect((await h.w("discard", "first")).code).toBe(0);
  expect((await h.w("show", "first")).code).not.toBe(0);
  expect((await h.w("show", "first:ex0")).code).not.toBe(0);

  expect((await h.w("accept", "second", "--actor", "you")).code).toBe(0);
  const card = (await h.w("show", "second")).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await h.w("show", "second:ex0")).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("the second reason");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 2026-03-01T09:05:00Z");
  expect(ex).toContain("session: sess-42");
  expect(ex).toMatch(/message: \d+/);
  expect(ex).toContain(`span: 0..${"the second reason".length}`);
});
