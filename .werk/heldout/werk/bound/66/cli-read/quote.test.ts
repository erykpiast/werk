import { expect, test } from "bun:test";
import { card, chat, events, lines, ok, project, seed } from "./helpers.ts";

const say = (kind: string, text: string, speaker: string, at: string) => ({
  speaker,
  at,
  session: "sess-42",
  kind,
  text,
});

function logsProject() {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "logs", [
    say("tool_result", "exit 0", "agent", "10:00"),
    say("spoken", "how do we store a chat?", "person", "10:01"),
    say("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  return p;
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = logsProject();
  await ok(p, ["add", "store", "--title", "One log per conversation"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  expect(lines(p)).toHaveLength(before + 1);
  const ev = events(p).at(-1);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("store");
  const id = ev.payload.id;
  const store = (await ok(p, ["show", "store"])).out;
  expect(store).toContain(`-> supported_by    ${id}  one log per conversation  (ghost, held)`);
  const ex = (await ok(p, ["show", id])).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-42");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  // The step names position 3 for the agent's message after a tool result and a person's message.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "talk", [
    say("spoken", "ship the reader first", "person", "1"),
    say("spoken", "agreed: ship the reader first", "agent", "2"),
    say("spoken", "retry, then retry again", "person", "3"),
  ]);
  await ok(p, ["add", "plan", "--title", "Reader first"]);
  const before = lines(p).length;
  const two = await p.werk(["quote", "plan", "talk", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "plan", "talk", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toContain("2 times in message");
  const none = await p.werk(["quote", "plan", "talk", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p)).toHaveLength(before);
  const show = (await ok(p, ["show", "plan"])).out;
  expect(show).not.toContain("supported_by");
  expect(show).not.toContain("Say");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = project();
  seed(p, [card("root", "Root")]);
  chat(p, "run", [
    say("tool_call", "run tests; expect exit code 137", "agent", "1"),
    say("tool_result", "exit code 137 from the runner", "agent", "2"),
    say("tooling", "note: exit code 137 means killed", "agent", "3"),
    say("spoken", "the runner died", "person", "4"),
  ]);
  await ok(p, ["add", "oom", "--title", "Runner memory"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "oom", "run", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toHaveLength(before);
  expect((await p.werk(["show", "oom:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = logsProject();
  await ok(p, ["add", "store", "--title", "One log per conversation"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const id = events(p).at(-1).payload.id;
  let before = lines(p).length;
  const add = await p.werk(["add", "store:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toHaveLength(before);
  const retitle = await p.werk(["propose", id, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "extra text" }])]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toHaveLength(before);
  expect((await ok(p, ["show", id])).out).toContain("\none log per conversation\n");
  await ok(p, ["say", id, "Is this the right quote?"]);
  expect(lines(p)).toHaveLength(before + 1);
  expect(events(p).at(-1)).toMatchObject({ type: "note.added", payload: { id } });
  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p).length;
  const after1 = await p.werk(["propose", id, "--title", "other words"]);
  expect(after1.code).not.toBe(0);
  const after2 = await p.werk(["propose", id, "--ops", JSON.stringify([{ tag: "new", new: "extra text" }])]);
  expect(after2.code).not.toBe(0);
  expect(lines(p)).toHaveLength(before);
  const shown = (await ok(p, ["show", id])).out;
  expect(shown).toContain("\none log per conversation\n");
  expect(shown).not.toContain("other words");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = logsProject();
  await ok(p, ["add", "first", "--title", "First"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  const ex1 = events(p).at(-1).payload.id;
  await ok(p, ["add", "second", "--title", "Second"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  const ex2 = events(p).at(-1).payload.id;
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", ex1])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const card2 = (await ok(p, ["show", "second"])).out.split("\n")[0];
  expect(card2).not.toContain("proposed");
  const ex = (await ok(p, ["show", ex2])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const field of [
    "one log per conversation",
    "speaker: agent",
    "said at: 10:02",
    "session: sess-42",
    "message: ",
    "span: ",
  ])
    expect(ex).toContain(field);
});
