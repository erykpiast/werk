import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter((l) => l !== "");
const msg = (kind: string, text: string, speaker: string, at: string, session = "sess1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function proj(chats: Record<string, string[]>): Project {
  const p = freshProject();
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "x", kind: "card", title: "X" } })}\n`,
  );
  mkdirSync(join(p.dir, ".werk", "chats"));
  for (const [n, ls] of Object.entries(chats)) writeFileSync(join(p.dir, ".werk", "chats", `${n}.jsonl`), `${ls.join("\n")}\n`);
  return p;
}
const ok = async (p: Project, a: string[]) => {
  const r = await p.werk(a);
  if (r.code !== 0) throw new Error(`${a.join(" ")}: ${r.err}`);
  return r;
};
const logs = () => ({
  logs: [
    msg("tool_result", "one log per conversation", "agent", "10:00"),
    msg("spoken", "how do we store a chat?", "person", "10:01"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ],
});

test("12.1 unique quote", async () => {
  const p = proj(logs());
  await ok(p, ["add", "store", "--title", "Store", "--parent", "x"]);
  const before = lines(p).length;
  const r = await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  expect(lines(p).length).toBe(before + 1);
  const ev = JSON.parse(lines(p).at(-1) as string);
  const text = "we keep one log per conversation and never rewrite it";
  expect(ev.payload.start).toBe(text.indexOf("one log per conversation"));
  expect(ev.payload.end).toBe(text.indexOf("one log per conversation") + "one log per conversation".length);
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess1");
  expect(ex).toContain("proposed");
  expect((await ok(p, ["show", "store"])).out).toContain("supported_by    store:ex0");
  expect(r.out).toContain("store:ex0");
});
test("12.1 position is 3", async () => {
  const p = proj(logs());
  await ok(p, ["add", "store", "--title", "Store", "--parent", "x"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toContain("message: 3\n");
});

test("12.2 non unique", async () => {
  const p = proj({
    c: [
      msg("spoken", "ship the reader first", "person", "1"),
      msg("spoken", "ship the reader first", "agent", "2"),
      msg("spoken", "retry, then retry again", "person", "3"),
    ],
  });
  await ok(p, ["add", "k", "--title", "K", "--parent", "x"]);
  const before = lines(p);
  const a = await p.werk(["quote", "k", "c", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "k", "c", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("2 times in message");
  const c = await p.werk(["quote", "k", "c", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "k:ex0"])).code).not.toBe(0);
});

test("12.3 tool output only", async () => {
  const p = proj({
    c: [
      msg("tool_result", "exit code 137 from the runner", "agent", "1"),
      msg("tool_call", "check exit code 137", "agent", "2"),
      msg("note", "tooling note exit code 137", "agent", "3"),
      msg("spoken", "it died", "person", "4"),
    ],
  });
  await ok(p, ["add", "k", "--title", "K", "--parent", "x"]);
  const before = lines(p);
  const r = await p.werk(["quote", "k", "c", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
});

test("12.4 hand edits refused", async () => {
  const p = proj(logs());
  await ok(p, ["add", "store", "--title", "Store", "--parent", "x"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const snap = () => lines(p);
  const before = snap();
  const add = await p.werk(["add", "store:ex1", "--kind", "excerpt", "--title", "my words"]);
  expect(add.code).not.toBe(0);
  expect(snap()).toEqual(before);
  const refused = async () => {
    for (const a of [
      ["retitle", "store:ex0", "other words"],
      ["edit", "store:ex0", "--body", "other words"],
      ["propose", "store:ex0", "--title", "other words"],
    ]) {
      const r = await p.werk(a);
      expect(r.code, a.join(" ")).not.toBe(0);
    }
    expect((await ok(p, ["show", "store:ex0"])).out).toContain("one log per conversation");
    expect((await ok(p, ["show", "store:ex0"])).out).not.toContain("other words");
  };
  await refused();
  await ok(p, ["say", "store:ex0", "A note"]);
  expect((await ok(p, ["show", "store:ex0"])).out).toContain("A note");
  await ok(p, ["accept", "store", "--actor", "you"]);
  await refused();
  expect((await ok(p, ["show", "store:ex0"])).out).toContain("A note");
});

test("12.5 follows citing card / 67.x", async () => {
  const p = proj(logs());
  await ok(p, ["add", "first", "--title", "First", "--parent", "x"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "x"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const c = (await ok(p, ["show", "second"])).out.split("\n")[0];
  expect(c).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["one log per conversation", "speaker: agent", "said at: 10:02", "session: sess1", "message: ", "span: 8..32"])
    expect(ex).toContain(s);
});

const session = (extra: string[] = []) => [
  msg("spoken", "hello", "user", "a"),
  msg("spoken", "Every quote in the imported map was written from memory", "user", "b"),
  msg("spoken", "ok, the tool never guesses", "assistant", "c"),
  ...extra,
];

test("67.1 and 67.2 ghost excerpt, findable by pointer", async () => {
  const p = proj({ s: session() });
  await ok(p, ["add", "werk-excerpt", "--title", "E", "--parent", "x"]);
  await ok(p, ["accept", "werk-excerpt", "--actor", "you"]);
  const r = await ok(p, ["quote", "#werk-excerpt", "s", "written from memory"]);
  expect(r.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  const full = "Every quote in the imported map was written from memory";
  const s = full.indexOf("written from memory");
  for (const t of ["session: sess1", "message: 1", "speaker: user", `span: ${s}..${s + 19}`]) expect(ex).toContain(t);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("supported_by    werk-excerpt:ex0");
  // 67.2: follow pointer into assistant message
  await ok(p, ["quote", "werk-excerpt", "s", "the tool never guesses"]);
  const ev = JSON.parse(lines(p).at(-1) as string).payload;
  const chat = readFileSync(join(p.dir, ".werk", "chats", "s.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(chat[ev.message].text.slice(ev.start, ev.end)).toBe("the tool never guesses");
  expect(chat[ev.message].speaker).toBe("assistant");
  expect((await ok(p, ["show", "werk-excerpt:ex1"])).out).toContain("speaker: assistant");
});

test("67.3 one changed character", async () => {
  const p = proj({ s: session() });
  const before = lines(p).length;
  const r = await p.werk(["quote", "x", "s", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "x:ex0"])).code).not.toBe(0);
});

test("67.4 two messages named", async () => {
  const t = "fails instead of guessing";
  const ls = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    msg("spoken", i === 3 || i === 7 ? `it ${t}` : `filler ${i}`, "user", String(i)),
  );
  const p = proj({ s: ls });
  const before = lines(p).length;
  const r = await p.werk(["quote", "x", "s", t]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/3/);
  expect(r.err).toMatch(/7/);
  expect(r.err).toContain("(3, 7)");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "x:ex0"])).code).not.toBe(0);
});

test("67.5 accept ghost excerpt", async () => {
  const p = proj({ s: session() });
  await ok(p, ["quote", "x", "s", "written from memory"]);
  await ok(p, ["accept", "x:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "x:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const x = (await ok(p, ["show", "x"])).out;
  expect(x).toContain("supported_by    x:ex0");
  expect(x).not.toContain("ghost");
});
