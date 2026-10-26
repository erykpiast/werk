// Held-out steps 12.1-12.5 and 67.1-67.5: werk quote.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function seed(p: Project, type: string, payload: object, actor = "you") {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor, type, payload })}\n`);
}

const msg = (kind: string, text: string, speaker: string, at: string, session = "sess-1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

function base(): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  return p;
}

test("12.1", async () => {
  const p = base();
  chat(p, "logs", [
    msg("tool_result", "ls output", "agent", "10:00"),
    msg("spoken", "how do we store a chat?", "person", "10:01"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  console.log("12.1 out:", run.out, run.err);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.payload.card).toBe("store");
  const showCard = (await ok(p, ["show", "store"])).out;
  expect(showCard).toContain("-> supported_by    store:ex0");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  console.log("12.1 excerpt:", ex);
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-1");
  const text = "we keep one log per conversation and never rewrite it";
  const s = text.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${s}..${s + "one log per conversation".length}`);
  // The step: the message position is 3.
  expect(ex).toContain("message: 3");
});

test("12.2", async () => {
  const p = base();
  chat(p, "c", [
    msg("spoken", "ship the reader first", "person", "1"),
    msg("spoken", "ok, ship the reader first then", "agent", "2"),
    msg("spoken", "retry, then retry again", "person", "3"),
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = readFileSync(logOf(p), "utf8");
  const a = await p.werk(["quote", "card", "c", "ship the reader first"]);
  console.log("12.2 a:", a);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "card", "c", "retry"]);
  console.log("12.2 b:", b);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.werk(["quote", "card", "c", "a sentence nobody said"]);
  console.log("12.2 c:", c);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(readFileSync(logOf(p), "utf8")).toBe(before);
  const show = (await ok(p, ["show", "card"])).out;
  expect(show).not.toContain("supported_by");
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.3", async () => {
  const p = base();
  chat(p, "c", [
    msg("spoken", "run it", "person", "1"),
    msg("tool_call", "run --check exit code 137", "agent", "2"),
    msg("tool_result", "exit code 137 from the runner", "agent", "3"),
    msg("tooling", "note: exit code 137 seen", "agent", "4"),
    msg("spoken", "the runner crashed", "agent", "5"),
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "card", "c", "exit code 137"]);
  console.log("12.3:", r);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.4", async () => {
  const p = base();
  chat(p, "c", [msg("spoken", "we bill per seat", "person", "1")]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  await ok(p, ["quote", "card", "c", "bill per seat"]);
  const snap = () => readFileSync(logOf(p), "utf8");
  let before = snap();
  const add = await p.werk(["add", "card:ex1", "--kind", "excerpt", "--title", "my own words"]);
  console.log("12.4 add:", add);
  expect(add.code).not.toBe(0);
  expect(snap()).toBe(before);
  const retitle = await p.werk(["retitle", "card:ex0", "other words"]);
  const edit = await p.werk(["edit", "card:ex0", "--body", "other words"]);
  console.log("12.4 retitle/edit:", retitle, edit);
  expect(retitle.code).not.toBe(0);
  expect(edit.code).not.toBe(0);
  expect(snap()).toBe(before);
  expect((await ok(p, ["show", "card:ex0"])).out.split("\n")[1]).toBe("bill per seat");
  await ok(p, ["say", "card:ex0", "Is this right?"]);
  expect((await ok(p, ["show", "card:ex0"])).out).toContain("Is this right?");
  await ok(p, ["accept", "card", "--actor", "you"]);
  before = snap();
  const edit2 = await p.werk(["edit", "card:ex0", "--body", "other words"]);
  const retitle2 = await p.werk(["retitle", "card:ex0", "other words"]);
  console.log("12.4 after accept:", edit2, retitle2);
  expect(edit2.code).not.toBe(0);
  expect(retitle2.code).not.toBe(0);
  expect(snap()).toBe(before);
  expect((await ok(p, ["show", "card:ex0"])).out.split("\n")[1]).toBe("bill per seat");
});

test("12.5", async () => {
  const p = base();
  chat(p, "c", [msg("spoken", "first quote here", "person", "t1"), msg("spoken", "second quote here", "agent", "t2")]);
  await ok(p, ["add", "one", "--title", "One", "--parent", "root"]);
  await ok(p, ["quote", "one", "c", "first quote"]);
  await ok(p, ["add", "two", "--title", "Two", "--parent", "root"]);
  await ok(p, ["quote", "two", "c", "second quote"]);
  const pre = (await ok(p, ["show", "two:ex0"])).out;
  await ok(p, ["discard", "one"]);
  expect((await p.werk(["show", "one"])).code).not.toBe(0);
  expect((await p.werk(["show", "one:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "two", "--actor", "you"]);
  const card = (await ok(p, ["show", "two"])).out;
  const ex = (await ok(p, ["show", "two:ex0"])).out;
  console.log("12.5:", card, ex);
  expect(card.split("\n")[0]).not.toContain("proposed");
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const want of ["second quote", "speaker: agent", "said at: t2", "session: sess-1", "message: 1", "span: 0..12"])
    expect(ex).toContain(want);
  expect(pre).toContain("span: 0..12");
});

function withExcerptCard(): Project {
  const p = base();
  seed(p, "node.added", { id: "werk-excerpt", kind: "card", title: "Excerpts", parent: "root" });
  return p;
}

test("67.1", async () => {
  const p = withExcerptCard();
  const said = "Every quote in the imported map was written from memory";
  chat(p, "s67", [
    msg("spoken", "hello", "user", "a", "s67"),
    msg("spoken", "hi", "assistant", "b", "s67"),
    msg("spoken", said, "user", "c", "s67"),
  ]);
  const r = await p.werk(["quote", "#werk-excerpt", "s67", "written from memory"]);
  console.log("67.1:", r);
  expect(r.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  console.log("67.1 ex:", ex);
  expect(ex.split("\n")[0]).toContain("proposed");
  const s = said.indexOf("written from memory");
  for (const want of ["session: s67", "message: 2", "speaker: user", `span: ${s}..${s + 19}`])
    expect(ex).toContain(want);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("-> supported_by    werk-excerpt:ex0");
});

test("67.2", async () => {
  const p = withExcerptCard();
  const rows = [
    msg("spoken", "what does the tool do on doubt?", "user", "a", "s672"),
    msg("tool_result", "noise", "assistant", "b", "s672"),
    msg("spoken", "It stops: the tool never guesses, it asks.", "assistant", "c", "s672"),
  ];
  chat(p, "s672", rows);
  await ok(p, ["quote", "werk-excerpt", "s672", "the tool never guesses"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const session = /session: (\S+)/.exec(ex)?.[1];
  const index = Number(/message: (\d+)/.exec(ex)?.[1]);
  const [start, end] = (/span: (\d+)\.\.(\d+)/.exec(ex) ?? []).slice(1).map(Number);
  const speaker = /speaker: (\S+)/.exec(ex)?.[1];
  expect(session).toBe("s672");
  const transcript = readFileSync(join(p.dir, ".werk", "chats", "s672.jsonl"), "utf8").split("\n");
  const line = JSON.parse(transcript[index] as string);
  expect(line.text.slice(start, end)).toBe("the tool never guesses");
  expect(line.speaker).toBe("assistant");
  expect(speaker).toBe("assistant");
});

test("67.3", async () => {
  const p = withExcerptCard();
  chat(p, "s673", [msg("spoken", "the rule: the tool never guesses", "assistant", "a", "s673")]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "werk-excerpt", "s673", "the tool never gueses"]);
  console.log("67.3:", r);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.4", async () => {
  const p = withExcerptCard();
  const rows = Array.from({ length: 9 }, (_, i) =>
    msg(
      "spoken",
      i === 3 || i === 7 ? `it fails instead of guessing (${i})` : `line ${i}`,
      i % 2 ? "assistant" : "user",
      `${i}`,
      "s674",
    ),
  );
  chat(p, "s674", rows);
  const before = lines(p).length;
  const r = await p.werk(["quote", "werk-excerpt", "s674", "fails instead of guessing"]);
  console.log("67.4:", r);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.5", async () => {
  const p = base();
  seed(p, "node.added", {
    id: "card",
    kind: "card",
    title: "Card",
    why: "W",
    status: "decided",
    who: "me",
    parent: "root",
  });
  chat(p, "s675", [msg("spoken", "keep it simple", "user", "a", "s675")]);
  await ok(p, ["quote", "card", "s675", "keep it simple"]);
  expect((await ok(p, ["show", "card:ex0"])).out.split("\n")[0]).toContain("proposed");
  const acc = await p.werk(["accept", "card:ex0", "--actor", "you"]);
  console.log("67.5:", acc);
  expect(acc.code).toBe(0);
  const ex = (await ok(p, ["show", "card:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  const card = (await ok(p, ["show", "card"])).out;
  console.log("67.5 card:", card);
  const link = card.split("\n").find((l) => l.includes("-> supported_by    card:ex0"));
  expect(link).toBeDefined();
  expect(link).not.toContain("ghost");
});
