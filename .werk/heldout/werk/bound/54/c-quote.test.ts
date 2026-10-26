// Held-out steps 12.1-12.5: `werk quote` makes excerpt ghosts from a conversation's chat log.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Line = { speaker: string; at: string; session: string; kind: string; text: string };

function chat(p: Project, name: string, lines: Line[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const logText = (p: Project) => readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8");
const events = (p: Project) => logText(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")}: ${r.err}`);
  return r;
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  chat(p, "c1", [
    { speaker: "tool", at: "t0", session: "s1", kind: "tool_result", text: "ok" },
    { speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "how do we store chats?" },
    { speaker: "agent", at: "t2", session: "s1", kind: "spoken", text: "we keep one log per conversation and never rewrite it" },
  ]);
  await ok(p, ["add", "logs", "--title", "One log per conversation"]);
  const before = events(p).length;
  const r = await p.werk(["quote", "logs", "c1", "one log per conversation"]);
  expect(r.code).toBe(0);
  const after = events(p);
  expect(after.length).toBe(before + 1);
  const ev = after.at(-1);
  // the one event holds both the excerpt and its link
  expect(ev.payload.card).toBe("logs");
  expect(ev.payload.title).toBe("one log per conversation");

  const card = (await ok(p, ["show", "logs"])).out;
  const exIds = [...card.matchAll(/(logs:ex\d+)/g)].map((m) => m[1]);
  expect(new Set(exIds).size).toBe(1);
  expect(card).toMatch(/supported_by/);
  const ex = (await ok(p, ["show", exIds[0] as string])).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: t2");
  expect(ex).toContain("session: s1");
  const at = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${at}..${at + "one log per conversation".length}`);
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, writes nothing", async () => {
  const p = freshProject();
  chat(p, "c2", [
    { speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "ship the reader first" },
    { speaker: "agent", at: "t2", session: "s1", kind: "spoken", text: "agreed: ship the reader first" },
    { speaker: "person", at: "t3", session: "s1", kind: "spoken", text: "retry, then retry again" },
  ]);
  await ok(p, ["add", "reader", "--title", "The reader ships first"]);
  const before = logText(p);
  const a = await p.werk(["quote", "reader", "c2", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toMatch(/2 messages/);
  const b = await p.werk(["quote", "reader", "c2", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.werk(["quote", "reader", "c2", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect(logText(p)).toBe(before);
  const show = (await ok(p, ["show", "reader"])).out;
  expect(show).not.toMatch(/reader:ex/);
  expect(show).not.toContain("supported_by");
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = freshProject();
  chat(p, "c3", [
    { speaker: "tool", at: "t0", session: "s1", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", at: "t1", session: "s1", kind: "tool_call", text: "check exit code 137" },
    { speaker: "werk", at: "t2", session: "s1", kind: "tooling", text: "note: exit code 137" },
    { speaker: "person", at: "t3", session: "s1", kind: "spoken", text: "why did the run die?" },
  ]);
  await ok(p, ["add", "oom", "--title", "The runner gets more memory"]);
  const before = logText(p);
  const r = await p.werk(["quote", "oom", "c3", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(logText(p)).toBe(before);
  expect((await ok(p, ["show", "oom"])).out).not.toMatch(/oom:ex/);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  chat(p, "c4", [{ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "use magic links for login" }]);
  await ok(p, ["add", "root", "--title", "Root"]);
  await ok(p, ["accept", "root", "--actor", "you"]);
  await ok(p, ["add", "login", "--title", "Login uses magic links", "--parent", "root"]);
  await ok(p, ["quote", "login", "c4", "magic links"]);
  const ex = "login:ex0";

  let before = logText(p);
  const add = await p.werk(["add", "login-ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(logText(p)).toBe(before);

  const retitle = await p.werk(["propose", ex, "--title", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["propose", ex, "--ops", JSON.stringify([{ tag: "new", new: "other text" }])]);
  expect(edit.code).not.toBe(0);
  expect(logText(p)).toBe(before);
  expect((await ok(p, ["show", ex])).out).toContain("magic links");

  const say = await p.werk(["say", ex, "a note on the excerpt"]);
  expect(say.code).toBe(0);
  expect(logText(p)).toContain("a note on the excerpt");

  await ok(p, ["accept", "login", "--actor", "you"]);
  before = logText(p);
  const again = await p.werk(["propose", ex, "--title", "other words"]);
  expect(again.code).not.toBe(0);
  expect(logText(p)).toBe(before);
  const shown = (await ok(p, ["show", ex])).out;
  expect(shown.split("\n")[1]).toBe("magic links");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  chat(p, "c5", [
    { speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "cache for sixty seconds" },
    { speaker: "agent", at: "t2", session: "s9", kind: "spoken", text: "then retry twice" },
  ]);
  await ok(p, ["add", "first", "--title", "Cache for a minute"]);
  await ok(p, ["add", "second", "--title", "Retry twice"]);
  await ok(p, ["quote", "first", "c5", "sixty seconds"]);
  await ok(p, ["quote", "second", "c5", "retry twice"]);

  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);

  await ok(p, ["accept", "second", "--actor", "you"]);
  const card = (await ok(p, ["show", "second"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex).toContain("retry twice");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: t2");
  expect(ex).toContain("session: s9");
  expect(ex).toContain("message: 1");
  expect(ex).toContain("span: 5..16");
});
