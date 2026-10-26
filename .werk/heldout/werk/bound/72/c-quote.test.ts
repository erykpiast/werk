// Held-out steps 12.x and 67.x: quoting a conversation into an excerpt.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

type Msg = { kind: string; text: string; speaker?: string; at?: string; session?: string };
function chat(p: Project, name: string, msgs: Msg[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${msgs
      .map((m) =>
        JSON.stringify({
          speaker: m.speaker ?? "person",
          at: m.at ?? "t",
          session: m.session ?? "sess-1",
          kind: m.kind,
          text: m.text,
        }),
      )
      .join("\n")}\n`,
  );
}

function withRoot(): Project {
  const p = freshProject();
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } })}\n`,
  );
  return p;
}

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = withRoot();
  chat(p, "logs", [
    { kind: "tool_result", text: "some tool output", speaker: "agent", at: "10:00" },
    { kind: "spoken", text: "how do we store a chat?", speaker: "person", at: "10:01" },
    {
      kind: "spoken",
      text: "we keep one log per conversation and never rewrite it",
      speaker: "agent",
      at: "10:02",
      session: "s-abc",
    },
  ]);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const after = lines(p);
  expect(after.length).toBe(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.type).toBe("excerpt.quoted");
  expect(ev.payload.card).toBe("store");
  const card = (await ok(p, ["show", "store"])).out;
  expect(card).toContain("-> supported_by    store:ex0  one log per conversation  (ghost, held)");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: s-abc");
  const at = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${at}..${at + "one log per conversation".length}`);
  // The step names position 3 for the third line.
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case, and writes nothing", async () => {
  const p = withRoot();
  chat(p, "c", [
    { kind: "spoken", text: "ship the reader first", speaker: "person" },
    { kind: "spoken", text: "ok, ship the reader first", speaker: "agent" },
    { kind: "spoken", text: "retry, then retry again", speaker: "person" },
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = lines(p);
  const a = await p.werk(["quote", "card", "c", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "card", "c", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message|2 matches/);
  const c = await p.werk(["quote", "card", "c", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "card"])).out;
  expect(show).not.toContain("supported_by");
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.3 text only in tool output is never quotable", async () => {
  const p = withRoot();
  chat(p, "c", [
    { kind: "tool_result", text: "exit code 137 from the runner", speaker: "agent" },
    { kind: "tool_call", text: "check exit code 137", speaker: "agent" },
    { kind: "tooling", text: "note: exit code 137", speaker: "agent" },
    { kind: "spoken", text: "the runner died", speaker: "person" },
  ]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "card", "c", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = withRoot();
  chat(p, "c", [{ kind: "spoken", text: "the tool never guesses", speaker: "person" }]);
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  await ok(p, ["quote", "card", "c", "the tool never guesses"]);
  let before = lines(p);
  const add = await p.werk(["add", "card:ex9", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const tries = [
    ["retitle", "card:ex0", "other words"],
    ["edit", "card:ex0", "--body", "other words"],
    ["propose", "card:ex0", "--title", "other words"],
  ];
  for (const t of tries) {
    const r = await p.werk(t);
    expect({ t, code: r.code }).not.toEqual({ t, code: 0 });
  }
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "card:ex0"])).out).toContain("the tool never guesses");
  await ok(p, ["say", "card:ex0", "a note on the excerpt"]);
  expect(lines(p).length).toBe(before.length + 1);
  expect(lines(p).at(-1)).toContain("a note on the excerpt");
  await ok(p, ["accept", "card", "--actor", "you"]);
  before = lines(p);
  for (const t of tries) {
    const r = await p.werk(t);
    expect({ t, code: r.code }).not.toEqual({ t, code: 0 });
  }
  expect(lines(p)).toEqual(before);
  const ex = (await ok(p, ["show", "card:ex0"])).out;
  expect(ex.split("\n")[1]).toBe("the tool never guesses");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = withRoot();
  chat(p, "c", [
    { kind: "spoken", text: "first quote here", speaker: "person", at: "t1", session: "S1" },
    { kind: "spoken", text: "second quote there", speaker: "agent", at: "t2", session: "S1" },
  ]);
  await ok(p, ["add", "one", "--title", "One", "--parent", "root"]);
  await ok(p, ["quote", "one", "c", "first quote"]);
  await ok(p, ["add", "two", "--title", "Two", "--parent", "root"]);
  await ok(p, ["quote", "two", "c", "second quote"]);
  const pointer = (await ok(p, ["show", "two:ex0"])).out.split("\n").slice(1, 8).join("\n");
  await ok(p, ["discard", "one"]);
  expect((await p.werk(["show", "one"])).code).not.toBe(0);
  expect((await p.werk(["show", "one:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "two", "--actor", "you"]);
  expect((await ok(p, ["show", "two"])).out.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "two:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  expect(ex.split("\n").slice(1, 8).join("\n")).toBe(pointer);
  for (const s of ["second quote", "speaker: agent", "said at: t2", "session: S1", "message: 1", "span: 0..12"])
    expect(ex).toContain(s);
});

test("67.1 a quote found once becomes a ghost excerpt on the citing card", async () => {
  const p = withRoot();
  await ok(p, ["add", "werk-excerpt", "--title", "Excerpts", "--parent", "root"]);
  await ok(p, ["accept", "werk-excerpt", "--actor", "you"]);
  const text = "Every quote in the imported map was written from memory";
  chat(p, "sess42", [
    { kind: "spoken", text: "hello", speaker: "assistant", session: "sess42" },
    { kind: "tool_call", text: "ls", speaker: "assistant", session: "sess42" },
    { kind: "spoken", text, speaker: "user", session: "sess42" },
  ]);
  await ok(p, ["quote", "#werk-excerpt", "sess42", "written from memory"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  const s = text.indexOf("written from memory");
  for (const want of ["session: sess42", "message: 2", "speaker: user", `span: ${s}..${s + 19}`])
    expect(ex).toContain(want);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("-> supported_by    werk-excerpt:ex0");
});

test("67.2 the excerpt lets the person find the quote again in the transcript", async () => {
  const p = withRoot();
  await ok(p, ["add", "werk-excerpt", "--title", "Excerpts", "--parent", "root"]);
  chat(p, "sess7", [
    { kind: "spoken", text: "what does it do?", speaker: "user", session: "sess7" },
    {
      kind: "spoken",
      text: "It reads the log, then it fails loudly on a bad line.",
      speaker: "assistant",
      session: "sess7",
    },
  ]);
  await ok(p, ["quote", "werk-excerpt", "sess7", "fails loudly"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const msg = Number(/message: (\d+)/.exec(ex)?.[1]);
  const [start, end] = (/span: (\d+)\.\.(\d+)/.exec(ex) as RegExpExecArray).slice(1).map(Number);
  const transcript = readFileSync(join(p.dir, ".werk", "chats", "sess7.jsonl"), "utf8").split("\n");
  const line = JSON.parse(transcript[msg] as string);
  expect(line.text.slice(start, end)).toBe("fails loudly");
  expect(line.speaker).toBe("assistant");
  expect(ex).toContain("speaker: assistant");
});

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = withRoot();
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  chat(p, "s", [{ kind: "spoken", text: "the tool never guesses", speaker: "user" }]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "card", "s", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("67.4 a quote in two messages fails and names both", async () => {
  const p = withRoot();
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  const msgs: Msg[] = Array.from({ length: 9 }, (_, i) => ({ kind: "spoken", text: `filler ${i}` }));
  msgs[3] = { kind: "spoken", text: "it fails instead of guessing", speaker: "user" };
  msgs[7] = { kind: "spoken", text: "yes, it fails instead of guessing", speaker: "assistant" };
  chat(p, "s", msgs);
  const before = lines(p).length;
  const r = await p.werk(["quote", "card", "s", "fails instead of guessing"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(lines(p).length).toBe(before);
  expect((await p.werk(["show", "card:ex0"])).code).not.toBe(0);
});

test("67.5 a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = withRoot();
  await ok(p, ["add", "card", "--title", "Card", "--parent", "root"]);
  await ok(p, ["accept", "card", "--actor", "you"]);
  chat(p, "s", [{ kind: "spoken", text: "quote me", speaker: "user" }]);
  await ok(p, ["quote", "card", "s", "quote me"]);
  await ok(p, ["accept", "card:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "card:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const card = (await ok(p, ["show", "card"])).out;
  expect(card).toContain("-> supported_by    card:ex0  quote me\n");
});
