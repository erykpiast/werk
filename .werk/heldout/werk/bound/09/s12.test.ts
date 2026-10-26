import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, events, ghost, link, ok, type Project, withMap } from "./helpers.ts";

const line = (kind: string, text: string, speaker: string, at: string) =>
  JSON.stringify({ speaker, at, session: "sess-42", kind, text });

function chat(p: Project, name: string, lines: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

/** A real root, a ghost card under it, and a source for the conversation that the ghost cites. */
const citing = () =>
  withMap([
    card("root", "Root"),
    ghost("log-design", "The log design", "root"),
    ["node.proposed", { id: "conv-design", kind: "source", title: "Conversation design" }, "agent"],
    link("log-design", "conv-design", "supported_by"),
  ]);

test("12.1", async () => {
  const p = citing();
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "design", [
    line("tool_result", "ls output", "agent", "2026-10-01T09:00:00Z"),
    line("spoken", "how many logs?", "person", "2026-10-01T09:01:00Z"),
    line("spoken", said, "agent", "2026-10-01T09:02:00Z"),
  ]);
  const before = events(p).length;
  const run = await p.werk(["quote", "log-design", "design", "one log per conversation"]);
  expect(run.code).toBe(0);
  const added = events(p).slice(before);
  expect(added).toHaveLength(1);
  const id = (added[0]?.payload as { id: string } | undefined)?.id ?? "";
  const card = (await ok(p, ["show", "log-design"])).out;
  expect(card).toMatch(new RegExp(`-> supported_by\\s+${id.replace(/[:]/g, "\\:")}`));
  const ex = (await ok(p, ["show", id])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  const payload = added[0]?.payload as Record<string, unknown>;
  expect(payload).toMatchObject({
    title: "one log per conversation",
    speaker: "agent",
    said_at: "2026-10-01T09:02:00Z",
    session: "sess-42",
    card: "log-design",
  });
  const start = said.indexOf("one log per conversation");
  expect({ start: payload.start, end: payload.end }).toEqual({ start, end: start + "one log per conversation".length });
  expect(payload.message).toBe(3);
});

test("12.2", async () => {
  const p = citing();
  chat(p, "design", [
    line("spoken", "ship the reader first", "person", "t0"),
    line("spoken", "ok: ship the reader first", "agent", "t1"),
    line("spoken", "retry, then retry again", "person", "t2"),
  ]);
  const before = events(p).length;
  const two = await p.werk(["quote", "log-design", "design", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "log-design", "design", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message|2 matches/);
  const none = await p.werk(["quote", "log-design", "design", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(events(p).length).toBe(before);
  const show = (await ok(p, ["show", "log-design"])).out;
  expect(show).not.toContain(":ex");
});

test("12.3", async () => {
  const p = citing();
  chat(p, "design", [
    line("tool_result", "exit code 137 from the runner", "agent", "t0"),
    line("tool_call", "echo exit code 137", "agent", "t1"),
    line("tooling", "the runner gave exit code 137", "agent", "t2"),
    line("spoken", "the build failed", "person", "t3"),
  ]);
  const before = events(p).length;
  const run = await p.werk(["quote", "log-design", "design", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(events(p).length).toBe(before);
});

test("12.4", async () => {
  const p = citing();
  chat(p, "design", [line("spoken", "we keep one log per conversation", "agent", "t0")]);
  await ok(p, ["quote", "log-design", "design", "one log per conversation"]);
  const id = "log-design:ex0";
  const n0 = events(p).length;
  const hand = await p.werk(["add", "log-design:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(hand.code).not.toBe(0);
  expect(events(p).length).toBe(n0);

  const retitle = await p.werk(["propose", id, "--title", "other words"]);
  const reText = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "invented text" }])]);
  const results = { retitle: retitle.code, reText: reText.code };
  const shown = (await ok(p, ["show", id])).out;
  expect(shown).toContain("one log per conversation");
  expect(shown).not.toContain("other words");
  expect(shown).not.toContain("invented text");
  expect(results).toEqual({ retitle: 1, reText: 1 });

  const note = await p.werk(["say", id, "Is this the right quote?"]);
  expect(note.code).toBe(0);
  expect((await ok(p, ["show", id])).out).toContain("Is this the right quote?");

  await ok(p, ["accept", "log-design", "--actor", "you"]);
  const again = await p.werk(["propose", id, "--title", "after accept"]);
  expect(again.code).not.toBe(0);
  expect((await ok(p, ["show", id])).out).toContain("one log per conversation");
  expect((await ok(p, ["show", id])).out).not.toContain("after accept");
});

test("12.5", async () => {
  const p = withMap([
    card("root", "Root"),
    ghost("first", "First card", "root"),
    ghost("second", "Second card", "root"),
  ]);
  chat(p, "design", [
    line("spoken", "alpha words here", "person", "2026-10-01T09:00:00Z"),
    line("spoken", "beta words there", "agent", "2026-10-01T09:05:00Z"),
  ]);
  await ok(p, ["quote", "first", "design", "alpha words"]);
  await ok(p, ["quote", "second", "design", "beta words"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).toBe(1);
  expect((await p.werk(["show", "first:ex0"])).code).toBe(1);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("beta words");
  // The pointer fields as the map holds them after the accept.
  const { fold } = await import("../src/map/fold.ts");
  const { readFileSync } = await import("node:fs");
  const node = fold(readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8")).nodes.get("second:ex0") as Record<
    string,
    unknown
  >;
  expect(node).toMatchObject({
    title: "beta words",
    speaker: "agent",
    said_at: "2026-10-01T09:05:00Z",
    session: "sess-42",
    message: 1,
    start: 0,
    end: 10,
  });
});
