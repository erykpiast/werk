// Held-out steps 12.1-12.5: quote and excerpts.
import { expect, test } from "bun:test";
import { card, chat, events, lines, ok, seeded } from "./cli-helpers.ts";

const spoken = (speaker: string, at: string, text: string) => ({ speaker, at, session: "sess-42", kind: "spoken", text });

async function withGhost(rows: Record<string, unknown>[], ids = ["c"]) {
  const p = seeded([card("root", "Root")]);
  chat(p, "conv", rows);
  for (const id of ids) await ok(p, ["add", id, "--title", `Card ${id}`, "--parent", "root", "--why", "w"]);
  return p;
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = await withGhost([
    { speaker: "agent", at: "2026-10-01T10:00:00Z", session: "sess-42", kind: "tool_result", text: "ls output" },
    spoken("person", "2026-10-01T10:01:00Z", "how do we store a conversation?"),
    spoken("agent", "2026-10-01T10:02:00Z", "we keep one log per conversation and never rewrite it"),
  ]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "c", "conv", "one log per conversation"]);
  expect(run.code).toBe(0);
  const card = (await ok(p, ["show", "c"])).out;
  const supported = card.split("\n").filter((l) => /-> supported_by/.test(l));
  expect(supported).toHaveLength(1);
  const id = /supported_by\s+(\S+)/.exec(supported[0] as string)?.[1] as string;
  const ex = (await ok(p, ["show", id])).out;
  expect(ex).toMatch(/^excerpt .*proposed/);
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 2026-10-01T10:02:00Z");
  expect(ex).toContain("session: sess-42");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(lines(p).length).toBe(before + 1);
  const last = events(p).at(-1);
  expect(last?.type).toBe("excerpt.quoted");
  expect(last?.payload.card).toBe("c");
  expect(last?.payload.id).toBe(id);
  // The step: the message position is 3, because the hidden tool result line counts.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = await withGhost([
    spoken("person", "t1", "ship the reader first"),
    spoken("agent", "t2", "agreed, ship the reader first"),
    spoken("person", "t3", "retry, then retry again"),
  ]);
  const before = lines(p).length;
  const two = await p.werk(["quote", "c", "conv", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toMatch(/2 messages/);
  const twice = await p.werk(["quote", "c", "conv", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message/);
  const none = await p.werk(["quote", "c", "conv", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toMatch(/no exact match/);
  expect((await ok(p, ["show", "c"])).out).not.toMatch(/supported_by|Say/);
  expect(lines(p).length).toBe(before);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = await withGhost([
    spoken("person", "t0", "why did the build stop?"),
    { speaker: "agent", at: "t1", session: "s", kind: "tool_call", text: "grep 'exit code 137' log" },
    { speaker: "agent", at: "t2", session: "s", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", at: "t3", session: "s", kind: "tooling", text: "note: exit code 137 seen" },
    spoken("agent", "t4", "the runner ran out of memory"),
  ]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "c", "conv", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/no exact match/);
  expect((await ok(p, ["show", "c"])).out).not.toMatch(/supported_by|Say/);
  expect(lines(p).length).toBe(before);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = await withGhost([spoken("person", "t1", "keep every event forever")]);
  await ok(p, ["quote", "c", "conv", "keep every event"]);
  const show = async () => (await ok(p, ["show", "c:ex0"])).out;
  const words = await show();
  let before = lines(p).length;
  const plain = await p.werk(["add", "c:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  const retitle = await p.werk(["propose", "c:ex0", "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const ops = JSON.stringify([{ tag: "new", new: "other text" }]);
  const edit = await p.werk(["propose", "c:ex0", "--ops", ops]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect(await show()).toBe(words);
  await ok(p, ["say", "c:ex0", "a note on the excerpt"]);
  const note = events(p).at(-1);
  expect(note?.type).toBe("note.added");
  expect(note?.payload.id).toBe("c:ex0");
  await ok(p, ["accept", "c", "--actor", "you"]);
  before = lines(p).length;
  const after = await show();
  const again = await p.werk(["propose", "c:ex0", "--ops", ops]);
  expect(again.code).not.toBe(0);
  expect(lines(p).length).toBe(before);
  expect(await show()).toBe(after);
  expect(after).toContain("keep every event");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = await withGhost([spoken("person", "2026-10-01T11:00:00Z", "first quote here; second quote there")], ["c1", "c2"]);
  await ok(p, ["quote", "c1", "conv", "first quote here"]);
  await ok(p, ["quote", "c2", "conv", "second quote there"]);
  await ok(p, ["discard", "c1"]);
  expect((await p.werk(["show", "c1"])).code).not.toBe(0);
  expect((await p.werk(["show", "c1:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "c2", "--actor", "you"]);
  const c2 = (await ok(p, ["show", "c2"])).out;
  expect(c2.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "c2:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const want of [
    "second quote there",
    "speaker: person",
    "said at: 2026-10-01T11:00:00Z",
    "session: sess-42",
    "message: 0",
    "span: 18..36",
  ])
    expect(ex).toContain(want);
});
