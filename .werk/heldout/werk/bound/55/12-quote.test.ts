// Scenarios 12.x: quote a conversation as an excerpt.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, events, lines, ok, type Project, withMap } from "./helpers.ts";

type Line = { speaker: string; at: string; session: string; kind: string; text: string };

async function project(chat: Line[], ghosts: string[] = ["design"]): Promise<Project> {
  const p = withMap([card("root", "Root")]);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(join(p.dir, ".werk", "chats", "conv-1.jsonl"), `${chat.map((l) => JSON.stringify(l)).join("\n")}\n`);
  for (const id of ghosts) await ok(p, ["add", id, "--title", `Card ${id}`, "--parent", "root"]);
  return p;
}
const said = (speaker: string, at: string, text: string, kind = "spoken"): Line => ({ speaker, at, session: "sess-42", kind, text });

const AGENT_TEXT = "Then we keep one log per conversation and never rewrite it.";

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = await project([
    said("tool", "2026-01-01T10:00:00Z", "ls output", "tool_result"),
    said("person", "2026-01-01T10:01:00Z", "How do we store chats?"),
    said("agent", "2026-01-01T10:02:00Z", AGENT_TEXT),
  ]);
  const n = lines(p).length;
  await ok(p, ["quote", "design", "conv-1", "one log per conversation"]);
  const card = (await ok(p, ["show", "design"])).out;
  const sup = card.split("\n").filter((l) => /-> supported_by/.test(l));
  expect(sup).toHaveLength(1);
  const id = (sup[0] as string).trim().split(/\s+/)[2] as string;
  expect(sup[0]).toContain("ghost");
  const ex = (await ok(p, ["show", id])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 2026-01-01T10:02:00Z");
  expect(ex).toContain("session: sess-42");
  const start = AGENT_TEXT.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  const added = events(p).slice(n);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "excerpt.quoted", payload: { id, card: "design" } });
  // Last: the step's message position.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = await project([
    said("person", "t1", "I say: ship the reader first."),
    said("agent", "t2", "Agreed, ship the reader first."),
    said("person", "t3", "If it breaks: retry, then retry again"),
  ]);
  const n = lines(p).length;
  const two = await p.werk(["quote", "design", "conv-1", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "design", "conv-1", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message|2 matches/);
  const none = await p.werk(["quote", "design", "conv-1", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect((await ok(p, ["show", "design"])).out).not.toContain("supported_by");
  expect(lines(p)).toHaveLength(n);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = await project([
    said("person", "t1", "Why did the build stop?"),
    said("agent", "t2", "run the job", "tool_call"),
    said("tool", "t3", "exit code 137 from the runner", "tool_result"),
    said("agent", "t4", "bash: exit code 137", "tool_call"),
    said("system", "t5", "note: exit code 137 seen", "tooling"),
    said("agent", "t6", "The runner ran out of memory."),
  ]);
  const n = lines(p).length;
  const run = await p.werk(["quote", "design", "conv-1", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toHaveLength(n);
  expect((await ok(p, ["show", "design"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = await project([said("agent", "t1", AGENT_TEXT)]);
  await ok(p, ["quote", "design", "conv-1", "one log per conversation"]);
  const ex = "design:ex0";
  let n = lines(p).length;
  const plain = await p.werk(["add", "design:ex1", "--kind", "excerpt", "--title", "words of my own"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p)).toHaveLength(n);
  for (const args of [
    ["propose", ex, "--title", "other words"],
    ["propose", ex, "--why", "other text"],
    ["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])],
  ]) {
    const run = await p.werk(args);
    expect(run.code).not.toBe(0);
    expect(lines(p)).toHaveLength(n);
  }
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
  await ok(p, ["say", ex, "Is this the right quote?"]);
  expect(events(p).at(-1)).toMatchObject({ type: "note.added", payload: { id: ex, text: "Is this the right quote?" } });
  await ok(p, ["accept", "design", "--actor", "you"]);
  n = lines(p).length;
  for (const args of [
    ["propose", ex, "--title", "other words"],
    ["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])],
  ]) {
    const run = await p.werk(args);
    expect(run.code).not.toBe(0);
    expect(lines(p)).toHaveLength(n);
  }
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = await project(
    [said("person", "2026-01-01T09:00:00Z", "first: we bill per seat"), said("agent", "2026-01-01T09:05:00Z", "second: invoices go out monthly")],
    ["first-card", "second-card"],
  );
  await ok(p, ["quote", "first-card", "conv-1", "we bill per seat"]);
  await ok(p, ["quote", "second-card", "conv-1", "invoices go out monthly"]);
  await ok(p, ["discard", "first-card"]);
  expect((await p.werk(["show", "first-card"])).code).not.toBe(0);
  expect((await p.werk(["show", "first-card:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second-card", "--actor", "you"]);
  const c = (await ok(p, ["show", "second-card"])).out;
  expect(c.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second-card:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("invoices go out monthly");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 2026-01-01T09:05:00Z");
  expect(ex).toContain("session: sess-42");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("span: 8..31");
});
