// Held-out steps 12.x: a quote makes an excerpt ghost from a conversation's spoken words.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, events, lines, ok, type Project, seeded } from "./helpers.ts";

function chat(p: Project, name: string, rows: object[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}
const row = (kind: string, speaker: string, at: string, text: string) => ({ speaker, at, session: "sess-42", kind, text });

const SAID = "we keep one log per conversation and never rewrite it";

async function citing(p: Project, id = "logging") {
  await ok(p, ["add", id, "--title", `Card ${id}`, "--parent", "root"]);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-1", [
    row("tool_result", "agent", "2026-10-01T09:00:00Z", "ls output"),
    row("spoken", "person", "2026-10-01T09:01:00Z", "how do we keep logs?"),
    row("spoken", "agent", "2026-10-01T09:02:00Z", SAID),
  ]);
  await citing(p);
  const n = lines(p).length;
  const run = await p.werk(["quote", "logging", "conv-1", "one log per conversation"]);
  expect(run.code).toBe(0);
  const added = events(p).slice(n);
  expect(added).toHaveLength(1);
  const ev = added[0];
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("logging");
  const id = ev.payload.id as string;
  const show = (await ok(p, ["show", "logging"])).out;
  expect(show).toMatch(new RegExp(`-> supported_by +${id}.*ghost`));
  const start = SAID.indexOf("one log per conversation");
  expect(ev.payload).toMatchObject({
    title: "one log per conversation",
    speaker: "agent",
    said_at: "2026-10-01T09:02:00Z",
    session: "sess-42",
    start,
    end: start + "one log per conversation".length,
  });
  expect(show).toContain('agent: "one log per conversation"');
  // The excerpt shows its time and its session in the map.
  const excerpt = (await ok(p, ["show", id])).out;
  expect(`${show}${excerpt}`).toContain("2026-10-01T09:02:00Z");
  expect(`${show}${excerpt}`).toContain("sess-42");
  expect(ev.payload.message).toBe(3);
});

test("12.1b the message position of 12.1", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-1", [
    row("tool_result", "agent", "t0", "ls output"),
    row("spoken", "person", "t1", "how do we keep logs?"),
    row("spoken", "agent", "t2", SAID),
  ]);
  await citing(p);
  await ok(p, ["quote", "logging", "conv-1", "one log per conversation"]);
  expect(events(p).at(-1).payload.message).toBe(3);
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-2", [
    row("spoken", "person", "t0", "ship the reader first"),
    row("spoken", "agent", "t1", "ok, ship the reader first"),
    row("spoken", "person", "t2", "retry, then retry again"),
  ]);
  await citing(p);
  const n = lines(p).length;
  const two = await p.werk(["quote", "logging", "conv-2", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "logging", "conv-2", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toContain("2 times in message");
  const none = await p.werk(["quote", "logging", "conv-2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  const show = (await ok(p, ["show", "logging"])).out;
  expect(show).not.toContain("supported_by");
  expect(show).not.toContain("Say");
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-3", [
    row("spoken", "person", "t0", "why did the job die?"),
    row("tool_call", "agent", "t1", "grep 'exit code 137' runner.log"),
    row("tool_result", "agent", "t2", "exit code 137 from the runner"),
    row("tooling", "agent", "t3", "note: exit code 137 seen"),
    row("spoken", "agent", "t4", "the runner ran out of memory"),
  ]);
  await citing(p);
  const n = lines(p).length;
  const run = await p.werk(["quote", "logging", "conv-3", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "logging"])).out).not.toContain("Say");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-4", [row("spoken", "person", "t0", "keep the words exact")]);
  await citing(p);
  await ok(p, ["quote", "logging", "conv-4", "keep the words exact"]);
  const id = events(p).at(-1).payload.id as string;
  let n = lines(p).length;
  const add = await p.werk(["add", "logging:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const retitle = await p.werk(["propose", id, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", id])).out).toContain("\nkeep the words exact\n");
  await ok(p, ["say", id, "a note on the excerpt"]);
  expect((await ok(p, ["show", id])).out).toContain("a note on the excerpt");
  await ok(p, ["accept", "logging", "--actor", "you"]);
  n = lines(p).length;
  const again = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(again.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", id])).out).toContain("\nkeep the words exact\n");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv-5", [
    row("spoken", "person", "2026-10-01T08:00:00Z", "first idea here"),
    row("spoken", "agent", "2026-10-01T08:01:00Z", "second idea here"),
  ]);
  await citing(p, "first");
  await citing(p, "second");
  await ok(p, ["quote", "first", "conv-5", "first idea"]);
  const one = events(p).at(-1).payload.id as string;
  await ok(p, ["quote", "second", "conv-5", "second idea"]);
  const two = events(p).at(-1).payload;
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", one])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const cardOut = (await ok(p, ["show", "second"])).out;
  const ex = (await ok(p, ["show", two.id])).out;
  expect(cardOut.split("\n")[0]).not.toContain("proposed");
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("\nsecond idea\n");
  expect(cardOut).toContain('agent: "second idea"');
  // Time, session, message position and span show on the excerpt.
  const all = `${cardOut}${ex}`;
  expect(all).toContain("2026-10-01T08:01:00Z");
  expect(all).toContain("sess-42");
  expect(all).toMatch(/message 1/);
  expect(all).toMatch(/0\.\.11/);
});
