// Held-out steps 12.x and 67.x: quotes from a conversation become excerpt ghosts.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

type Msg = { kind: string; text: string; speaker: string; at: string };
const msg = (kind: string, text: string, speaker: string, at: string): Msg => ({ kind, text, speaker, at });

function chat(p: Project, name: string, msgs: Msg[], session = "sess-1"): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    msgs.map((m) => `${JSON.stringify({ ...m, session })}\n`).join(""),
  );
}

function seed(p: Project, events: { type: string; payload: object }[]): void {
  const start = lines(p).length;
  appendFileSync(
    logOf(p),
    events.map((e, i) => `${JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

function withRoot(): Project {
  const p = freshProject();
  seed(p, [{ type: "node.added", payload: { id: "root", kind: "card", title: "Root" } }]);
  return p;
}

const LOGS = [
  msg("tool_result", "one log per conversation", "agent", "10:00"),
  msg("spoken", "how do we store a chat?", "person", "10:01"),
  msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
];

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = withRoot();
  chat(p, "logs", LOGS);
  await ok(p, ["add", "store", "--title", "One log", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.payload.card).toBe("store");
  const id = ev.payload.id as string;
  const card = (await ok(p, ["show", "store"])).out;
  expect(card).toContain(`-> supported_by    ${id}  one log per conversation`);
  const show = (await ok(p, ["show", id])).out;
  expect(show).toContain("proposed");
  expect(show).toContain("one log per conversation");
  expect(show).toContain("speaker: agent");
  expect(show).toContain("said at: 10:02");
  expect(show).toContain("session: sess-1");
  const text = LOGS[2]?.text as string;
  const s = text.indexOf("one log per conversation");
  expect(show).toContain(`span: ${s}..${s + "one log per conversation".length}`);
  // The step: the message position is 3, because the hidden tool result line counts.
  expect(show).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = withRoot();
  chat(p, "c", [
    msg("spoken", "ship the reader first", "person", "1"),
    msg("spoken", "ok: ship the reader first", "agent", "2"),
    msg("spoken", "retry, then retry again", "person", "3"),
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = lines(p);
  const showBefore = (await ok(p, ["show", "card"])).out;
  const a = await p.werk(["quote", "card", "c", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "card", "c", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("2 times in message");
  const c = await p.werk(["quote", "card", "c", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "card"])).out).toBe(showBefore);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = withRoot();
  chat(p, "c", [
    msg("tool_result", "exit code 137 from the runner", "agent", "1"),
    msg("tool_call", "check exit code 137", "agent", "2"),
    msg("tooling", "tooling saw exit code 137", "agent", "3"),
    msg("spoken", "the runner failed", "person", "4"),
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "card", "c", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = withRoot();
  chat(p, "logs", LOGS);
  await ok(p, ["add", "store", "--title", "One log", "--parent", "root"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const ex = "store:ex0";
  const before = lines(p);
  const add = await p.werk(["add", "store:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["retitle", ex, "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["edit", ex, "--body", "other words"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", ex])).out).toContain("one log per conversation");
  await ok(p, ["say", ex, "a note on the quote"]);
  expect(lines(p).length).toBe(before.length + 1);
  expect((await ok(p, ["inbox"])).out + (await ok(p, ["show", ex])).out).toContain("a note on the quote");
  await ok(p, ["accept", "store", "--actor", "you"]);
  const mid = lines(p);
  const edit2 = await p.werk(["edit", ex, "--body", "other words"]);
  expect(edit2.code).not.toBe(0);
  const retitle2 = await p.werk(["retitle", ex, "other words"]);
  expect(retitle2.code).not.toBe(0);
  expect(lines(p)).toEqual(mid);
  const shown = (await ok(p, ["show", ex])).out;
  expect(shown.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = withRoot();
  chat(p, "logs", LOGS);
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "second", "logs", "never rewrite it"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const card = (await ok(p, ["show", "second"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  const s = (LOGS[2]?.text as string).indexOf("never rewrite it");
  for (const want of [
    "never rewrite it",
    "speaker: agent",
    "said at: 10:02",
    "session: sess-1",
    "message: 2",
    `span: ${s}..${s + 16}`,
  ])
    expect(ex).toContain(want);
});

function werkExcerpt(): Project {
  const p = withRoot();
  seed(p, [{ type: "node.added", payload: { id: "werk-excerpt", kind: "card", title: "Excerpts", parent: "root" } }]);
  return p;
}

test("67.1 a quote found once becomes a ghost excerpt on the citing card", async () => {
  const p = werkExcerpt();
  const text = "Every quote in the imported map was written from memory";
  chat(p, "rec", [
    msg("spoken", "hello", "assistant", "1"),
    msg("tool_result", "noise", "assistant", "2"),
    msg("spoken", text, "user", "3"),
  ]);
  const run = await p.werk(["quote", "#werk-excerpt", "rec", "written from memory"]);
  expect(run.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const s = text.indexOf("written from memory");
  expect(ex.split("\n")[0]).toContain("proposed");
  for (const want of ["session: sess-1", "message: 2", "speaker: user", `span: ${s}..${s + 19}`])
    expect(ex).toContain(want);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("-> supported_by    werk-excerpt:ex0");
});

test("67.2 the excerpt lets the person find the quote again in the transcript", async () => {
  const p = werkExcerpt();
  const msgs = [
    msg("spoken", "what does the tool do on a miss?", "user", "1"),
    msg("spoken", "On a miss the tool never guesses and fails loudly", "assistant", "2"),
  ];
  chat(p, "rec", msgs);
  await ok(p, ["quote", "werk-excerpt", "rec", "the tool never guesses"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const message = Number(/message: (\d+)/.exec(ex)?.[1]);
  const [, a, b] = /span: (\d+)\.\.(\d+)/.exec(ex) ?? [];
  const session = /session: (\S+)/.exec(ex)?.[1];
  const file = readFileSync(join(p.dir, ".werk", "chats", "rec.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);
  const line = JSON.parse(file[message] as string);
  expect(line.session).toBe(session);
  expect(line.text.slice(Number(a), Number(b))).toBe("the tool never guesses");
  expect(line.speaker).toBe("assistant");
  expect(ex).toContain("speaker: assistant");
});

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = werkExcerpt();
  chat(p, "rec", [msg("spoken", "the tool never guesses", "assistant", "1")]);
  const before = lines(p);
  const run = await p.werk(["quote", "werk-excerpt", "rec", "the tool never gueses"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.4 a quote in two messages fails and names both messages", async () => {
  const p = werkExcerpt();
  const msgs = Array.from({ length: 9 }, (_, i) => msg("spoken", `line ${i}`, "user", String(i)));
  msgs[3] = msg("spoken", "the tool fails instead of guessing", "assistant", "3");
  msgs[7] = msg("spoken", "again it fails instead of guessing", "assistant", "7");
  chat(p, "rec", msgs);
  const before = lines(p);
  const run = await p.werk(["quote", "werk-excerpt", "rec", "fails instead of guessing"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/\b3\b/);
  expect(run.err).toMatch(/\b7\b/);
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.5 a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = werkExcerpt();
  chat(p, "rec", [msg("spoken", "the tool never guesses", "assistant", "1")]);
  await ok(p, ["quote", "werk-excerpt", "rec", "never guesses"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "werk-excerpt:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const card = (await ok(p, ["show", "werk-excerpt"])).out;
  expect(card).toContain("-> supported_by    werk-excerpt:ex0  never guesses\n");
});
