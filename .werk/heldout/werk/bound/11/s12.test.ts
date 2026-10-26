import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, events, lines, ok, seeded } from "./helpers.ts";

function chat(p: Project, name: string, rows: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}
const row = (kind: string, text: string, speaker: string, at: string) => ({ speaker, at, session: "sess-42", kind, text });

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = seeded([card("root", "Root")]);
  await ok(p, ["add", "log-shape", "--title", "One log per conversation", "--parent", "root"]);
  const said = "we keep one log per conversation and never rewrite it";
  chat(p, "c1", [
    row("tool_result", "listing files", "agent", "t0"),
    row("spoken", "how do we store chats?", "person", "t1"),
    row("spoken", said, "agent", "t2"),
  ]);
  const n = lines(p).length;
  const run = await p.werk(["quote", "log-shape", "c1", "one log per conversation"]);
  expect(run.code).toBe(0);
  const added = events(p).slice(n);
  expect(added.length).toBe(1);
  const start = said.indexOf("one log per conversation");
  expect(added[0]).toMatchObject({
    type: "excerpt.quoted",
    payload: { card: "log-shape", title: "one log per conversation", speaker: "agent", said_at: "t2", session: "sess-42" },
  });
  const id = added[0].payload.id as string;
  const show = (await ok(p, ["show", id])).out;
  expect(show.split("\n")[0]).toContain("proposed");
  expect(show).toContain("one log per conversation");
  expect(show).toContain("<- supported_by    log-shape");
  // The pointer fields as the log holds them.
  expect(added[0].payload.message).toBe(3);
  expect(added[0].payload.start).toBe(start);
  expect(added[0].payload.end).toBe(start + "one log per conversation".length);
  expect(run.out).toContain("message 3");
  expect(run.out).toContain(`span ${start}..${start + 24}`);
  // The citing card's show prints the speaker and the words.
  const cardShow = (await ok(p, ["show", "log-shape"])).out;
  expect(cardShow).toContain('agent: "one log per conversation"');
  // The excerpt as the map shows it carries its time and session.
  expect(show).toContain("t2");
  expect(show).toContain("sess-42");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = seeded([card("root", "Root")]);
  await ok(p, ["add", "plan", "--title", "Plan", "--parent", "root"]);
  chat(p, "c2", [
    row("spoken", "ship the reader first", "person", "t0"),
    row("spoken", "ok, ship the reader first", "agent", "t1"),
    row("spoken", "retry, then retry again", "person", "t2"),
  ]);
  const n = lines(p).length;
  const two = await p.werk(["quote", "plan", "c2", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "plan", "c2", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toContain("2 times in message");
  const none = await p.werk(["quote", "plan", "c2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "plan"])).out).not.toContain("supported_by");
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = seeded([card("root", "Root")]);
  await ok(p, ["add", "runner", "--title", "Runner", "--parent", "root"]);
  chat(p, "c3", [
    row("tool_call", "run tests; expect exit code 137", "agent", "t0"),
    row("tool_result", "exit code 137 from the runner", "agent", "t1"),
    row("tooling", "note: exit code 137 seen", "agent", "t2"),
    row("spoken", "the runner failed", "agent", "t3"),
  ]);
  const n = lines(p).length;
  const run = await p.werk(["quote", "runner", "c3", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "runner"])).out).not.toContain("Say");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = seeded([card("root", "Root")]);
  await ok(p, ["add", "cite", "--title", "Cite", "--parent", "root"]);
  chat(p, "c4", [row("spoken", "quoted words here", "person", "t0")]);
  await ok(p, ["quote", "cite", "c4", "quoted words here"]);
  let n = lines(p).length;
  const plain = await p.werk(["add", "cite:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const retitle = await p.werk(["propose", "cite:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const ops = JSON.stringify([{ tag: "new", new: "added text" }]);
  const edit = await p.werk(["propose", "cite:ex0", "--ops", ops]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "cite:ex0"])).out).toContain("quoted words here");
  await ok(p, ["say", "cite:ex0", "a note on the excerpt"]);
  expect(lines(p).length).toBe(n + 1);
  expect(events(p).at(-1)).toMatchObject({ type: "note.added", payload: { id: "cite:ex0" } });
  await ok(p, ["accept", "cite", "--actor", "you"]);
  n = lines(p).length;
  const edit2 = await p.werk(["propose", "cite:ex0", "--title", "other words"]);
  expect(edit2.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const show = (await ok(p, ["show", "cite:ex0"])).out;
  expect(show).toContain("quoted words here");
  expect(show).not.toContain("other words");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = seeded([card("root", "Root")]);
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  chat(p, "c5", [
    row("spoken", "alpha words", "person", "t0"),
    row("spoken", "beta words", "agent", "t1"),
  ]);
  await ok(p, ["quote", "first", "c5", "alpha words"]);
  await ok(p, ["quote", "second", "c5", "beta words"]);
  const before = events(p).find((e) => e.payload.id === "second:ex0").payload;
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("beta words");
  console.log("12.5 show of excerpt:\n" + ex);
  expect(before).toMatchObject({ speaker: "agent", said_at: "t1", session: "sess-42", message: 1, start: 0, end: 10 });
  const show = (await ok(p, ["show", "second"])).out;
  expect(show).toContain('agent: "beta words"');
  expect(ex).toContain("sess-42");
  expect(ex).toContain("t1");
});
