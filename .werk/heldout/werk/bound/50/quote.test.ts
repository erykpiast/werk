// Scenarios 06.1 (command-line part) and 12.x: quotes become excerpt ghosts.
import { expect, test } from "bun:test";
import { cardView, chat, decided, events, head, lines, ok, project, real, seed, serve } from "./helpers.ts";

const SESSION = "6ae61be7-sess";
const AGENT_SAID = "we keep one log per conversation and never rewrite it";
const AGENT_AT = "2026-10-02T09:15:00.000Z";

function design(p: ReturnType<typeof project>): void {
  chat(p, "design", [
    { speaker: "agent", at: "2026-10-02T09:13:00.000Z", session: SESSION, kind: "tool_result", text: "ls .werk" },
    {
      speaker: "person",
      at: "2026-10-02T09:14:00.000Z",
      session: SESSION,
      kind: "spoken",
      text: "how do we store chats?",
    },
    { speaker: "agent", at: AGENT_AT, session: SESSION, kind: "spoken", text: AGENT_SAID },
  ]);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = project();
  seed(p, [real("root", "Root")]);
  design(p);
  await ok(p, ["add", "chat-log", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "chat-log", "design", "one log per conversation"]);
  expect(run.code).toBe(0);
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  const id = fresh[0]?.payload.id as string;
  expect(fresh[0]?.payload.card).toBe("chat-log");

  const card = (await ok(p, ["show", "chat-log"])).out;
  const supported = card.split("\n").filter((line) => line.includes("supported_by"));
  expect(supported).toHaveLength(1);
  expect(supported[0]).toContain(id);
  const excerpt = (await ok(p, ["show", id])).out;
  expect(excerpt.split("\n")[0]).toContain("proposed");

  const start = AGENT_SAID.indexOf("one log per conversation");
  expect(fresh[0]?.payload.start).toBe(start);
  expect(fresh[0]?.payload.end).toBe(start + "one log per conversation".length);
  expect(fresh[0]?.payload.message).toBe(3);
  // What the person can see of the excerpt: its show text and its page in the map.
  const base = await serve(p);
  const view = `${excerpt}\n${card}\n${(await cardView(base, id)) ?? ""}`;
  expect(view).toContain("one log per conversation");
  expect(view).toContain("agent");
  expect(view).toContain(AGENT_AT);
  expect(view).toContain(SESSION);

});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = project();
  seed(p, [real("root", "Root")]);
  chat(p, "plan", [
    { speaker: "person", at: "t1", session: SESSION, kind: "spoken", text: "ship the reader first" },
    { speaker: "agent", at: "t2", session: SESSION, kind: "spoken", text: "ok, ship the reader first" },
    { speaker: "person", at: "t3", session: SESSION, kind: "spoken", text: "retry, then retry again" },
  ]);
  await ok(p, ["add", "reader", "--title", "Reader first", "--parent", "root"]);
  const before = lines(p);
  const two = await p.werk(["quote", "reader", "plan", "ship the reader first"]);
  expect(two.code).not.toBe(0);
  expect(two.err).toContain("2 messages");
  const twice = await p.werk(["quote", "reader", "plan", "retry"]);
  expect(twice.code).not.toBe(0);
  expect(twice.err).toMatch(/2 times in message|2 matches/);
  const none = await p.werk(["quote", "reader", "plan", "a sentence nobody said"]);
  expect(none.code).not.toBe(0);
  expect(none.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "reader"])).out).not.toContain("supported_by");
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = project();
  seed(p, [real("root", "Root")]);
  chat(p, "ci", [
    { speaker: "agent", at: "t1", session: SESSION, kind: "tool_call", text: "grep 'exit code 137' runner.log" },
    { speaker: "agent", at: "t2", session: SESSION, kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", at: "t3", session: SESSION, kind: "tooling", text: "note: exit code 137 seen" },
    { speaker: "person", at: "t4", session: SESSION, kind: "spoken", text: "why did the runner die?" },
  ]);
  await ok(p, ["add", "oom", "--title", "The runner runs out of memory", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "oom", "ci", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "oom"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = project();
  seed(p, [real("root", "Root")]);
  design(p);
  await ok(p, ["add", "chat-log", "--title", "One log per conversation", "--parent", "root"]);
  await ok(p, ["quote", "chat-log", "design", "one log per conversation"]);
  const id = "chat-log:ex0";
  expect(await head(p, id)).toStartWith(`excerpt ${id}`);

  let before = lines(p);
  const plain = await p.werk(["add", "hand-ex", "--kind", "excerpt", "--title", "words I wrote myself"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p)).toEqual(before);

  const retitle = await p.werk(["propose", id, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const ops = JSON.stringify([{ tag: "new", new: "a body I wrote" }]);
  const edit = await p.werk(["propose", id, "--ops", ops]);
  expect(edit.code).not.toBe(0);
  const why = await p.werk(["propose", id, "--why", "edited"]);
  expect(why.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", id])).out.split("\n")[1]).toBe("one log per conversation");

  await ok(p, ["say", id, "a note on the excerpt"]);
  expect((await ok(p, ["show", id])).out).toContain("a note on the excerpt");

  await ok(p, ["accept", "chat-log", "--actor", "you"]);
  before = lines(p);
  const after = await p.werk(["propose", id, "--ops", ops]);
  expect(after.code).not.toBe(0);
  const afterTitle = await p.werk(["propose", id, "--title", "other words"]);
  expect(afterTitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", id])).out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = project();
  seed(p, [real("root", "Root")]);
  chat(p, "design", [
    {
      speaker: "person",
      at: "2026-10-02T09:14:00.000Z",
      session: SESSION,
      kind: "spoken",
      text: "keep the log append-only",
    },
    { speaker: "agent", at: AGENT_AT, session: SESSION, kind: "spoken", text: AGENT_SAID },
  ]);
  await ok(p, ["add", "first", "--title", "First card", "--parent", "root"]);
  await ok(p, ["add", "second", "--title", "Second card", "--parent", "root"]);
  await ok(p, ["quote", "first", "design", "append-only"]);
  await ok(p, ["quote", "second", "design", "one log per conversation"]);

  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);

  await ok(p, ["accept", "second", "--actor", "you"]);
  expect(await head(p, "second")).not.toContain("proposed");
  const excerptHead = await head(p, "second:ex0");
  expect(excerptHead).toStartWith("excerpt second:ex0");
  expect(excerptHead).not.toContain("proposed");

  const excerpt = (await ok(p, ["show", "second:ex0"])).out;
  const card = (await ok(p, ["show", "second"])).out;
  const base = await serve(p);
  const view = `${excerpt}\n${card}\n${(await cardView(base, "second:ex0")) ?? ""}`;
  const start = AGENT_SAID.indexOf("one log per conversation");
  expect(view).toContain("one log per conversation");
  expect(view).toContain("agent");
  expect(view).toContain(AGENT_AT);
  expect(view).toContain(SESSION);
  expect(view).toMatch(/message 1\b/);
  expect(view).toContain(`${start}..${start + "one log per conversation".length}`);
});

test("06.1 a new excerpt for a decided card stages as a ghost (command line)", async () => {
  const p = project();
  seed(p, [real("root", "Root"), real("retry", "Retry reuses the link", "root"), decided("retry")]);
  design(p);
  const before = (await ok(p, ["show", "retry"])).out;
  const run = await p.werk(["quote", "retry", "design", "one log per conversation"]);
  expect(run.code).toBe(0);
  expect(run.out).toContain("proposed");
  expect(run.out).not.toContain("added");
  const excerpt = (await ok(p, ["show", "retry:ex0"])).out;
  expect(excerpt.split("\n")[0]).toContain("proposed");
  const card = (await ok(p, ["show", "retry"])).out;
  const link = card.split("\n").find((line) => line.includes("supported_by") && line.includes("retry:ex0"));
  expect(link).toContain("held");
  expect(card.split("\n")[0]).toBe(before.split("\n")[0]);
  expect(card.split("\n")[0]).toContain("[decided]");
  expect(card.split("\n")[1]).toBe("Retry reuses the link");
});
