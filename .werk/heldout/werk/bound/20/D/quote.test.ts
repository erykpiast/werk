// Held-out steps 12.1-12.5 and 67.1-67.5: the quote verb, excerpts and their ghosts.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

type Line = { speaker: string; at: string; session: string; kind: string; text: string };
const line = (kind: string, text: string, speaker: string, at: string, session = "sess-1"): Line => ({
  speaker,
  at,
  session,
  kind,
  text,
});

function withRoot(): Project {
  const p = freshProject();
  const root = {
    seq: 1,
    at: "t",
    actor: "you",
    type: "node.added",
    payload: { id: "root", kind: "card", title: "Root" },
  };
  appendFileSync(logOf(p), `${JSON.stringify(root)}\n`);
  return p;
}

function chat(p: Project, name: string, ls: Line[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), ls.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.out}${run.err}`);
  return run;
}

const field = (out: string, name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(out)?.[1];

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = withRoot();
  chat(p, "logs", [
    line("tool_result", "one log per conversation", "agent", "10:00"),
    line("spoken", "how do we store a chat?", "person", "10:01"),
    line("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  await ok(p, ["add", "store", "--title", "Chats are stored per conversation", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const event = JSON.parse(after.at(-1) as string);
  // One event holds both the excerpt and the link from the card.
  expect(event.payload.card).toBe("store");
  const show = (await ok(p, ["show", "store"])).out;
  const links = show.split("\n").filter((l) => /-> supported_by/.test(l));
  expect(links).toHaveLength(1);
  const id = /-> supported_by\s+(\S+)/.exec(links[0] as string)?.[1] as string;
  const ex = (await ok(p, ["show", id])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(field(ex, "speaker")).toBe("agent");
  expect(field(ex, "said at")).toBe("10:02");
  expect(field(ex, "session")).toBe("sess-1");
  const msg = "we keep one log per conversation and never rewrite it";
  const at = msg.indexOf("one log per conversation");
  expect(field(ex, "span")).toBe(`${at}..${at + "one log per conversation".length}`);
  // The step: the position is 3, because the hidden tool result line counts.
  expect(field(ex, "message")).toBe("3");
});

test("12.2 a quote that is not unique fails, says which case, writes nothing", async () => {
  const p = withRoot();
  chat(p, "plan", [
    line("spoken", "ship the reader first", "person", "t0"),
    line("spoken", "agreed, ship the reader first", "agent", "t1"),
    line("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ok(p, ["add", "plan-card", "--title", "Reader ships first", "--parent", "root"]);
  const before = lines(p);
  const showBefore = (await ok(p, ["show", "plan-card"])).out;
  const a = await p.werk(["quote", "plan-card", "plan", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "plan-card", "plan", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.werk(["quote", "plan-card", "plan", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect((await ok(p, ["show", "plan-card"])).out).toBe(showBefore);
  expect((await p.werk(["show", "plan-card:ex0"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = withRoot();
  chat(p, "run", [
    line("spoken", "why did the build die?", "person", "t0"),
    line("tool_call", "tail runner.log | grep 'exit code 137'", "agent", "t1"),
    line("tool_result", "exit code 137 from the runner", "agent", "t2"),
    line("tooling", "note: exit code 137 means killed", "agent", "t3"),
    line("spoken", "the runner ran out of memory", "agent", "t4"),
  ]);
  await ok(p, ["add", "oom", "--title", "The runner needs more memory", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "oom", "run", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "oom:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = withRoot();
  chat(p, "c", [line("spoken", "seats are the unit we bill", "person", "t0")]);
  await ok(p, ["add", "seat", "--title", "We bill per seat", "--parent", "root"]);
  await ok(p, ["quote", "seat", "c", "seats are the unit"]);
  const exBefore = (await ok(p, ["show", "seat:ex0"])).out;

  let n = lines(p).length;
  const add = await p.werk(["add", "seat:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p).length).toBe(n);

  const retitle = await p.werk(["retitle", "seat:ex0", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["edit", "seat:ex0", "--body", "other words"]);
  expect(edit.code).not.toBe(0);
  const propose = await p.werk(["propose", "seat:ex0", "--title", "other words"]);
  expect(propose.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "seat:ex0"])).out).toBe(exBefore);

  await ok(p, ["say", "seat:ex0", "Is this the right quote?"]);
  expect(lines(p).length).toBe(n + 1);
  expect((await ok(p, ["inbox"])).out + (await ok(p, ["show", "seat:ex0"])).out).toContain("Is this the right quote?");

  await ok(p, ["accept", "seat", "--actor", "you"]);
  n = lines(p).length;
  const words = (await ok(p, ["show", "seat:ex0"])).out.split("\n")[1];
  for (const args of [
    ["retitle", "seat:ex0", "other words"],
    ["edit", "seat:ex0", "--body", "other words"],
    ["propose", "seat:ex0", "--title", "other words"],
  ]) {
    const r = await p.werk(args);
    expect(r.code).not.toBe(0);
  }
  expect(lines(p).length).toBe(n);
  expect((await ok(p, ["show", "seat:ex0"])).out.split("\n")[1]).toBe(words as string);
  expect(words).toBe("seats are the unit");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = withRoot();
  chat(p, "c", [
    line("spoken", "seats are the unit we bill", "person", "t0"),
    line("spoken", "invoices go out monthly", "agent", "t1"),
  ]);
  await ok(p, ["add", "first", "--title", "We bill per seat", "--parent", "root"]);
  await ok(p, ["quote", "first", "c", "seats are the unit"]);
  await ok(p, ["add", "second", "--title", "Invoices are monthly", "--parent", "root"]);
  await ok(p, ["quote", "second", "c", "go out monthly"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  expect((await ok(p, ["show", "second"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex.split("\n")[1]).toBe("go out monthly");
  expect(field(ex, "speaker")).toBe("agent");
  expect(field(ex, "said at")).toBe("t1");
  expect(field(ex, "session")).toBe("sess-1");
  expect(field(ex, "message")).toBe("1");
  expect(field(ex, "span")).toBe("9..23");
});

// The recorded session in werk's own chat-log format, as the chat pane records it.
function recorded(p: Project): void {
  chat(p, "s1", [
    line("spoken", "How do we import the old map?", "person", "t0"),
    line("spoken", "I can rebuild it from the notes.", "agent", "t1"),
    line("spoken", "Every quote in the imported map was written from memory", "person", "t2"),
    line("spoken", "Then the tool never guesses: it fails instead of guessing", "agent", "t3"),
  ]);
}

test("67.1 a quote found once becomes a ghost excerpt on the citing card", async () => {
  const p = withRoot();
  recorded(p);
  await ok(p, ["add", "werk-excerpt", "--title", "Quotes are exact", "--parent", "root"]);
  await ok(p, ["accept", "werk-excerpt", "--actor", "you"]);
  const run = await p.werk(["quote", "#werk-excerpt", "s1", "written from memory"]);
  expect(run.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(field(ex, "session")).toBe("sess-1");
  expect(field(ex, "message")).toBe("2");
  const msg = "Every quote in the imported map was written from memory";
  const at = msg.indexOf("written from memory");
  expect(field(ex, "span")).toBe(`${at}..${at + "written from memory".length}`);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toMatch(/-> supported_by\s+werk-excerpt:ex0/);
  // The step names the speaker "user"; werk records the person's messages as "person".
  expect(field(ex, "speaker")).toBe("user");
});

test("67.2 the excerpt lets the person find the quote again", async () => {
  const p = withRoot();
  recorded(p);
  await ok(p, ["add", "werk-excerpt", "--title", "Quotes are exact", "--parent", "root"]);
  await ok(p, ["quote", "werk-excerpt", "s1", "never guesses"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const transcript = readFileSync(join(p.dir, ".werk", "chats", "s1.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
  const session = field(ex, "session");
  const index = Number(field(ex, "message"));
  const [start, end] = (field(ex, "span") as string).split("..").map(Number) as [number, number];
  const msg = transcript[index] as Line;
  expect(msg.session).toBe(session as string);
  expect(msg.text.slice(start, end)).toBe("never guesses");
  expect(field(ex, "speaker")).toBe(msg.speaker);
  // The step names the speaker "assistant"; werk records the agent's messages as "agent".
  expect(msg.speaker).toBe("assistant");
});

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = withRoot();
  recorded(p);
  await ok(p, ["add", "werk-excerpt", "--title", "Quotes are exact", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "werk-excerpt", "s1", "the tool never gueses"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await ok(p, ["show", "werk-excerpt"])).out).not.toContain("supported_by");
});

test("67.4 a quote in two messages fails and names both messages", async () => {
  const p = withRoot();
  const ls: Line[] = [];
  for (let i = 0; i < 9; i++) ls.push(line("spoken", `message number ${i}`, i % 2 ? "agent" : "person", `t${i}`));
  ls[3] = line("spoken", "the check fails instead of guessing", "agent", "t3");
  ls[7] = line("spoken", "it still fails instead of guessing", "person", "t7");
  chat(p, "s1", ls);
  await ok(p, ["add", "werk-excerpt", "--title", "Quotes are exact", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "werk-excerpt", "s1", "fails instead of guessing"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toMatch(/\b3\b/);
  expect(run.err).toMatch(/\b7\b/);
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.5 a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = withRoot();
  recorded(p);
  await ok(p, ["add", "werk-excerpt", "--title", "Quotes are exact", "--parent", "root"]);
  await ok(p, ["accept", "werk-excerpt", "--actor", "you"]);
  await ok(p, ["quote", "werk-excerpt", "s1", "written from memory"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "werk-excerpt:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const card = (await ok(p, ["show", "werk-excerpt"])).out;
  const link = card.split("\n").find((l) => /-> supported_by\s+werk-excerpt:ex0/.test(l)) as string;
  expect(link).toBeDefined();
  expect(link).not.toMatch(/ghost|held/);
});
