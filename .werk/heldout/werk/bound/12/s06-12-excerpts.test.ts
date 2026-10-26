import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, events, lines, ok, type Project, withMap } from "./helpers.ts";

function chat(p: Project, name: string, rows: object[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}
const AGENT_MSG = "Agreed: we keep one log per conversation and never rewrite it.";
const basicChat = (p: Project) =>
  chat(p, "c1", [
    { kind: "tool_result", speaker: "tool", at: "2026-10-01T10:00:00Z", session: "sess-1", text: "ok" },
    { kind: "spoken", speaker: "person", at: "2026-10-01T10:01:00Z", session: "sess-1", text: "How do we store chats?" },
    { kind: "spoken", speaker: "agent", at: "2026-10-01T10:02:00Z", session: "sess-1", text: AGENT_MSG },
  ]);

test("06.1 a new excerpt for a decided card stages as a ghost", async () => {
  const p = withMap([card("root", "Root"), card("logs", "One log per chat", "root", { status: "decided", why: "W", body: "B" })]);
  basicChat(p);
  const before = (await ok(p, ["show", "logs"])).out;
  const q = await ok(p, ["quote", "logs", "c1", "one log per conversation"]);
  expect(q.out).toContain("proposed");
  expect(q.out).not.toContain("added");
  const id = "logs:ex0";
  expect((await ok(p, ["show", id])).out.split("\n")[0]).toContain("proposed");
  const after = (await ok(p, ["show", "logs"])).out;
  expect(after).toMatch(/-> supported_by\s+logs:ex0 {2}one log per conversation {2}\(ghost, held\)/);
  expect(after.split("\n")[0]).toBe(before.split("\n")[0]);
  expect(after).toContain("One log per chat\nwhy: W");
  expect(after).toContain("\nB\n");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  const p = withMap([card("root", "Root"), card("logs", "One log per chat", "root", { status: "decided" })]);
  basicChat(p);
  await ok(p, ["quote", "logs", "c1", "one log per conversation"]);
  const before = lines(p).length;
  await ok(p, ["accept", "logs:ex0", "--actor", "you"]);
  expect(lines(p).length).toBe(before + 1);
  expect((await ok(p, ["show", "logs:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const show = (await ok(p, ["show", "logs"])).out;
  expect(show).toContain("  -> supported_by    logs:ex0  one log per conversation\n");
});

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = withMap([card("root", "Root")]);
  basicChat(p);
  await ok(p, ["add", "store", "--title", "Chats are stored as logs", "--parent", "root"]);
  const before = lines(p).length;
  const q = await p.werk(["quote", "store", "c1", "one log per conversation"]);
  expect(q.code).toBe(0);
  const added = events(p).slice(before);
  expect(added.length).toBe(1);
  expect(added[0].type).toBe("excerpt.quoted");
  const start = AGENT_MSG.indexOf("one log per conversation");
  // The pointer in the log
  expect(added[0].payload).toMatchObject({
    title: "one log per conversation",
    speaker: "agent",
    said_at: "2026-10-01T10:02:00Z",
    session: "sess-1",
    message: 2,
    start,
    end: start + "one log per conversation".length,
  });
  const id = added[0].payload.id;
  expect((await ok(p, ["show", "store"])).out).toMatch(new RegExp(`-> supported_by\\s+${id}.*\\(ghost, held\\)`));
  // What the map shows for the excerpt
  const ex = (await ok(p, ["show", id])).out;
  expect(ex.split("\n")[0]).toContain("excerpt");
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  // message position: step says 3 (counting from one, hidden tool line included); log holds 2 counting from zero
  const shows = { speaker: ex.includes("agent"), time: ex.includes("2026-10-01T10:02:00Z"), session: ex.includes("sess-1") };
  expect(shows).toEqual({ speaker: true, time: true, session: true });
  expect(ex).toMatch(/message\D*3|position\D*3/);
});

function ambiguousChat(p: Project) {
  chat(p, "c2", [
    { kind: "spoken", speaker: "person", at: "t1", session: "s", text: "I say: ship the reader first." },
    { kind: "spoken", speaker: "agent", at: "t2", session: "s", text: "Yes, ship the reader first." },
    { kind: "spoken", speaker: "person", at: "t3", session: "s", text: "retry, then retry again" },
  ]);
}

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = withMap([card("root", "Root")]);
  ambiguousChat(p);
  await ok(p, ["add", "plan", "--title", "Plan", "--parent", "root"]);
  const before = lines(p);
  const two = await p.werk(["quote", "plan", "c2", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "plan", "c2", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message|2 matches/);
  const none = await p.werk(["quote", "plan", "c2", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "plan"])).out;
  expect(show).not.toContain("supported_by");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = withMap([card("root", "Root")]);
  chat(p, "c3", [
    { kind: "spoken", speaker: "person", at: "t1", session: "s", text: "Why did the job die?" },
    { kind: "tool_call", speaker: "agent", at: "t2", session: "s", text: "grep 'exit code 137' runner.log" },
    { kind: "tool_result", speaker: "tool", at: "t3", session: "s", text: "exit code 137 from the runner" },
    { kind: "tooling", speaker: "tool", at: "t4", session: "s", text: "note: exit code 137 seen" },
    { kind: "spoken", speaker: "agent", at: "t5", session: "s", text: "The runner ran out of memory." },
  ]);
  await ok(p, ["add", "oom", "--title", "OOM", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "oom", "c3", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "oom"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = withMap([card("root", "Root")]);
  basicChat(p);
  await ok(p, ["add", "store", "--title", "Chats are stored as logs", "--parent", "root"]);
  await ok(p, ["quote", "store", "c1", "one log per conversation"]);
  const id = "store:ex0";
  let before = lines(p);
  const add = await p.werk(["add", "store:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  for (const args of [
    ["propose", id, "--title", "other words"],
    ["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])],
  ]) {
    const r = await p.werk(args);
    expect(r.code).not.toBe(0);
  }
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", id])).out.split("\n")[1]).toBe("one log per conversation");
  await ok(p, ["say", id, "Good quote"]);
  expect((await ok(p, ["show", id])).out).toContain("agent: Good quote");
  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p);
  const r = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(r.code).not.toBe(0);
  const r2 = await p.werk(["propose", id, "--title", "other words"]);
  expect(r2.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", id])).out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = withMap([card("root", "Root")]);
  chat(p, "c4", [
    { kind: "spoken", speaker: "person", at: "2026-01-01T00:00:00Z", session: "s9", text: "alpha words here" },
    { kind: "spoken", speaker: "agent", at: "2026-01-01T00:01:00Z", session: "s9", text: "beta words there" },
  ]);
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "first", "c4", "alpha words"]);
  await ok(p, ["quote", "second", "c4", "beta words"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).toBe(1);
  expect((await p.werk(["show", "first:ex0"])).code).toBe(1);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).toBe("card second  [open]");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("beta words");
  const quoted = events(p).find((e) => e.type === "excerpt.quoted" && e.payload.id === "second:ex0");
  expect(quoted.payload).toMatchObject({ speaker: "agent", said_at: "2026-01-01T00:01:00Z", session: "s9", message: 1, start: 0, end: 10 });
  // the map's view of the excerpt shows its pointer
  expect({ speaker: ex.includes("agent"), time: ex.includes("2026-01-01T00:01:00Z"), session: ex.includes("s9"), span: /0\D+10/.test(ex) }).toEqual({ speaker: true, time: true, session: true, span: true });
});
