// Held-out steps 12.x: werk quote and excerpts.
import { expect, test } from "bun:test";
import { card, chat, project } from "./helpers.ts";

const header = (out: string) => out.split("\n")[0] as string;

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = project();
  p.seed(card("root", "Root"));
  chat(p, "design", [
    { kind: "tool_result", speaker: "agent", text: "ls output" },
    { kind: "spoken", speaker: "person", text: "how do we store chats?", at: "2026-10-01T10:01:00Z" },
    {
      kind: "spoken",
      speaker: "agent",
      text: "we keep one log per conversation and never rewrite it",
      at: "2026-10-01T10:02:00Z",
    },
  ]);
  await p.ok("add", "chat-logs", "--title", "Chat logs are append only", "--parent", "root");
  const n = p.lines().length;
  const run = await p.werk(["quote", "chat-logs", "design", "one log per conversation"]);
  expect(run.code).toBe(0);
  const events = p.lines().slice(n);
  expect(events).toHaveLength(1);
  const id = events[0]?.payload.id as string;
  expect(events[0]?.payload.card).toBe("chat-logs");

  expect(await p.ok("show", "chat-logs")).toMatch(new RegExp(`-> supported_by\\s+${id}\\s.*\\(ghost, held\\)`));
  const shown = await p.ok("show", id);
  expect(header(shown)).toContain("excerpt");
  expect(header(shown)).toContain("proposed");
  expect(shown).toContain("one log per conversation");
  expect(shown).toContain("speaker: agent");
  expect(shown).toContain("said at: 2026-10-01T10:02:00Z");
  expect(shown).toContain("session: sess-1");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(shown).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(shown).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = project();
  p.seed(card("root", "Root"));
  chat(p, "plan", [
    { kind: "spoken", speaker: "person", text: "ship the reader first" },
    { kind: "spoken", speaker: "agent", text: "agreed, ship the reader first" },
    { kind: "spoken", speaker: "person", text: "retry, then retry again" },
  ]);
  await p.ok("add", "reader", "--title", "The reader goes first", "--parent", "root");
  const n = p.lines().length;
  const twoMessages = await p.werk(["quote", "reader", "plan", "ship the reader first"]);
  expect(twoMessages.code).not.toBe(0);
  expect(twoMessages.err).toMatch(/2 messages/);
  const twoInOne = await p.werk(["quote", "reader", "plan", "retry"]);
  expect(twoInOne.code).not.toBe(0);
  expect(twoInOne.err).toMatch(/2 (times|matches) in (one )?message/);
  const none = await p.werk(["quote", "reader", "plan", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toMatch(/no (exact )?match/);
  expect(await p.ok("show", "reader")).not.toContain("supported_by");
  expect((await p.werk(["show", "reader:ex0"])).code).not.toBe(0);
  expect(p.lines().length).toBe(n);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = project();
  p.seed(card("root", "Root"));
  chat(p, "ci", [
    { kind: "tool_call", speaker: "agent", text: "grep 'exit code 137' runner.log" },
    { kind: "tool_result", speaker: "agent", text: "exit code 137 from the runner" },
    { kind: "tooling", speaker: "agent", text: "note: exit code 137 means killed" },
    { kind: "spoken", speaker: "person", text: "why did the job die?" },
  ]);
  await p.ok("add", "oom", "--title", "The runner gets more memory", "--parent", "root");
  const n = p.lines().length;
  const run = await p.werk(["quote", "oom", "ci", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/no (exact )?match/);
  expect(p.lines().length).toBe(n);
  expect(await p.ok("show", "oom")).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = project();
  p.seed(card("root", "Root"));
  chat(p, "talk", [{ kind: "spoken", speaker: "person", text: "the cache lives one minute" }]);
  await p.ok("add", "cache", "--title", "The cache lives one minute", "--parent", "root");
  await p.ok("quote", "cache", "talk", "the cache lives one minute");
  const ex = "cache:ex0";

  let n = p.lines().length;
  const plain = await p.werk(["add", "cache:ex1", "--kind", "excerpt", "--title", "words of my own"]);
  expect(plain.code).not.toBe(0);
  expect(p.lines().length).toBe(n);

  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "more words" }])]);
  expect(edit.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect((await p.ok("show", ex)).split("\n")[1]).toBe("the cache lives one minute");

  await p.ok("say", ex, "Is one minute enough?");
  expect(p.lines().at(-1)).toMatchObject({ type: "note.added", payload: { id: ex, text: "Is one minute enough?" } });

  await p.ok("accept", "cache", "--actor", "you");
  n = p.lines().length;
  const later = await p.werk(["propose", ex, "--title", "other words"]);
  expect(later.code).not.toBe(0);
  const laterOps = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "more words" }])]);
  expect(laterOps.code).not.toBe(0);
  expect(p.lines().length).toBe(n);
  expect((await p.ok("show", ex)).split("\n")[1]).toBe("the cache lives one minute");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = project();
  p.seed(card("root", "Root"));
  chat(p, "talk", [
    { kind: "spoken", speaker: "person", text: "the first idea", at: "2026-10-01T10:00:00Z" },
    { kind: "spoken", speaker: "agent", text: "the second idea", at: "2026-10-01T10:01:00Z" },
  ]);
  await p.ok("add", "first", "--title", "First card", "--parent", "root");
  await p.ok("add", "second", "--title", "Second card", "--parent", "root");
  await p.ok("quote", "first", "talk", "the first idea");
  await p.ok("quote", "second", "talk", "the second idea");
  const before = await p.ok("show", "second:ex0");

  await p.ok("discard", "first");
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);

  await p.ok("accept", "second", "--actor", "you");
  expect(header(await p.ok("show", "second"))).not.toContain("proposed");
  const after = await p.ok("show", "second:ex0");
  expect(header(after)).not.toContain("proposed");
  for (const line of [
    "the second idea",
    "speaker: agent",
    "said at: 2026-10-01T10:01:00Z",
    "session: sess-1",
    "message:",
    "span: 0..15",
  ])
    expect(after).toContain(line);
  // Everything but the ghost word is the same as before the accept.
  expect(after.split("\n").slice(1, 8)).toEqual(before.split("\n").slice(1, 8));
});
