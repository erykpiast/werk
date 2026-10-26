import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));
const msg = (kind: string, text: string, speaker: string, at: string, session = "sess-42") =>
  JSON.stringify({ speaker, at, session, kind, text });

function seed(p: Project, payload: Record<string, unknown>) {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload })}\n`);
}
function chat(p: Project, name: string, rows: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.join("\n")}\n`);
}
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

// ---------- 12.x ----------
function logsProject() {
  const p = freshProject();
  seed(p, { id: "root", kind: "card", title: "Root" });
  chat(p, "logs", [
    msg("tool_result", "one log per conversation", "agent", "10:00"),
    msg("spoken", "how do we store a chat?", "person", "10:01"),
    msg("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  return p;
}

test("12.1", async () => {
  const p = logsProject();
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(r.code).toBe(0);
  const show = (await ok(p, ["show", "store"])).out;
  const sup = show.split("\n").filter((l) => l.includes("supported_by"));
  expect(sup).toHaveLength(1);
  expect(sup[0]).toContain("store:ex0");
  expect(sup[0]).toContain("ghost");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  console.log("12.1 excerpt:\n" + ex);
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-42");
  // "message position is 3, because the hidden tool result line counts"
  const text = "we keep one log per conversation and never rewrite it";
  const s = text.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${s}..${s + "one log per conversation".length}`);
  expect(lines(p)).toHaveLength(before + 1);
  const last = events(p).at(-1);
  expect(last.payload.id).toBe("store:ex0");
  expect(last.payload.card).toBe("store");
  expect(ex).toContain("message: 3");
});

test("12.2", async () => {
  const p = freshProject();
  seed(p, { id: "root", kind: "card", title: "Root" });
  chat(p, "plan", [
    msg("spoken", "ship the reader first", "person", "t0"),
    msg("spoken", "ok, ship the reader first then", "agent", "t1"),
    msg("spoken", "retry, then retry again", "person", "t2"),
  ]);
  await ok(p, ["add", "c", "--title", "C", "--parent", "root"]);
  const before = lines(p);
  const a = await p.werk(["quote", "c", "plan", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "c", "plan", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("2 times in message 2");
  const c = await p.werk(["quote", "c", "plan", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect((await ok(p, ["show", "c"])).out).not.toContain("supported_by");
  expect((await p.werk(["show", "c:ex0"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

test("12.3", async () => {
  const p = freshProject();
  seed(p, { id: "root", kind: "card", title: "Root" });
  chat(p, "run", [
    msg("spoken", "why did it die?", "person", "t0"),
    msg("tool_call", "grep 'exit code 137' runner.log", "agent", "t1"),
    msg("tool_result", "exit code 137 from the runner", "agent", "t2"),
    msg("tooling", "note: exit code 137 means killed", "agent", "t3"),
    msg("spoken", "the runner ran out of memory", "agent", "t4"),
  ]);
  await ok(p, ["add", "c", "--title", "C", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "c", "run", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect((await p.werk(["show", "c:ex0"])).code).not.toBe(0);
  expect(lines(p)).toEqual(before);
});

test("12.4", async () => {
  const p = logsProject();
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  let before = lines(p);
  const add = await p.werk(["add", "store:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const rt = await p.werk(["retitle", "store:ex0", "other words"]);
  expect(rt.code).not.toBe(0);
  const ed = await p.werk(["edit", "store:ex0", "--body", "other text"]);
  expect(ed.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  let ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex.split("\n")[1]).toBe("one log per conversation");
  expect(ex).not.toContain("other");
  await ok(p, ["say", "store:ex0", "Is this the right quote?"]);
  expect((await ok(p, ["show", "store:ex0"])).out).toContain("Is this the right quote?");
  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p);
  const ed2 = await p.werk(["edit", "store:ex0", "--body", "other text"]);
  expect(ed2.code).not.toBe(0);
  const rt2 = await p.werk(["retitle", "store:ex0", "other words"]);
  expect(rt2.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex.split("\n")[1]).toBe("one log per conversation");
});

test("12.5", async () => {
  const p = logsProject();
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const card = (await ok(p, ["show", "second"])).out;
  expect(card.split("\n")[0]).not.toContain("proposed");
  expect(card).not.toContain("ghost");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  console.log("12.5 excerpt:\n" + ex);
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["one log per conversation", "speaker: agent", "said at: 10:02", "session: sess-42", "message: 2", "span: 8..32"])
    expect(ex).toContain(s);
});

// ---------- 67.x ----------
function excerptProject() {
  const p = freshProject();
  seed(p, { id: "werk-excerpt", kind: "card", title: "Excerpts cite the transcript" });
  return p;
}

test("67.1", async () => {
  const p = excerptProject();
  const said = "Every quote in the imported map was written from memory";
  chat(p, "s1", [
    msg("spoken", "hello", "agent", "t0", "sess-67"),
    msg("spoken", said, "person", "t1", "sess-67"),
  ]);
  const r = await p.werk(["quote", "#werk-excerpt", "s1", "written from memory"]);
  expect(r.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  console.log("67.1 excerpt:\n" + ex);
  expect(ex.split("\n")[0]).toContain("proposed");
  const s = said.indexOf("written from memory");
  expect(ex).toContain("session: sess-67");
  expect(ex).toContain("message: 1");
  expect(ex).toContain(`span: ${s}..${s + "written from memory".length}`);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("supported_by    werk-excerpt:ex0");
  expect(ex).toContain("speaker: user");
});

test("67.2", async () => {
  const p = excerptProject();
  const rows = [
    msg("spoken", "what does the tool do on a miss?", "person", "t0", "sess-672"),
    msg("spoken", "On a miss the tool fails loudly and never guesses.", "agent", "t1", "sess-672"),
  ];
  chat(p, "s2", rows);
  await ok(p, ["quote", "werk-excerpt", "s2", "fails loudly"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const get = (k: string) => (ex.match(new RegExp(`^${k}: (.*)$`, "m")) ?? [])[1] as string;
  const session = get("session");
  const index = Number(get("message"));
  const [start, end] = get("span").split("..").map(Number) as [number, number];
  const transcript = readFileSync(join(p.dir, ".werk", "chats", "s2.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const line = transcript[index];
  expect(line.session).toBe(session);
  expect(line.text.slice(start, end)).toBe("fails loudly");
  expect(get("speaker")).toBe(line.speaker);
  expect(get("speaker")).toBe("assistant");
});

test("67.3", async () => {
  const p = excerptProject();
  chat(p, "s3", [msg("spoken", "the tool never guesses", "agent", "t0")]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "werk-excerpt", "s3", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(lines(p)).toHaveLength(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.4", async () => {
  const p = excerptProject();
  const rows: string[] = [];
  for (let i = 0; i < 9; i++)
    rows.push(msg("spoken", i === 3 || i === 7 ? `it fails instead of guessing, line ${i}` : `filler ${i}`, i % 2 ? "agent" : "person", `t${i}`));
  chat(p, "s4", rows);
  const before = lines(p).length;
  const r = await p.werk(["quote", "werk-excerpt", "s4", "fails instead of guessing"]);
  console.log("67.4 err: " + r.err);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\(3, 7\)/);
  expect(lines(p)).toHaveLength(before);
  expect((await p.werk(["show", "werk-excerpt:ex0"])).code).not.toBe(0);
});

test("67.5", async () => {
  const p = excerptProject();
  chat(p, "s5", [msg("spoken", "per seat it is", "person", "t0")]);
  await ok(p, ["quote", "werk-excerpt", "s5", "per seat"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "werk-excerpt:ex0", "--actor", "you"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toBe("excerpt werk-excerpt:ex0  [open]");
  const card = (await ok(p, ["show", "werk-excerpt"])).out;
  expect(card).toContain("  -> supported_by    werk-excerpt:ex0  per seat\n");
});

// ---------- 68.x ----------
test("68.1", async () => {
  const p = freshProject();
  seed(p, { id: "werk-chat", kind: "card", title: "The composer sends a live agent turn", why: "W", status: "decided", who: "me" });
  const before = lines(p).length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const ev = events(p);
  expect(ev).toHaveLength(before + 1);
  expect(ev.at(-1)).toMatchObject({ type: "note.added", payload: { id: "werk-chat" } });
  const show = (await ok(p, ["show", "#werk-chat"])).out;
  expect(show).toContain("The reply streams over SSE");
});

function groups(out: string) {
  // inbox prints "[seq] #id  title\n    text" per note; group by id
  const g = new Map<string, string[]>();
  const ls = out.split("\n");
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i]?.match(/^\[\d+\] #(\S+)/);
    if (m) {
      const id = m[1] as string;
      if (!g.has(id)) g.set(id, []);
      g.get(id)?.push((ls[i + 1] ?? "").trim());
    }
  }
  return g;
}

test("68.2", async () => {
  const p = freshProject();
  seed(p, { id: "werk-chat", kind: "card", title: "Chat" });
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", t]);
  const out = (await ok(p, ["inbox"])).out;
  console.log("68.2 inbox: " + JSON.stringify(out));
  expect(groups(out).get("werk-chat")).toEqual(["first", "second", "third"]);
});

test("68.3", async () => {
  const p = freshProject();
  seed(p, { id: "werk-chat", kind: "card", title: "Chat" });
  seed(p, { id: "visual", kind: "card", title: "Visual" });
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const out = (await ok(p, ["inbox"])).out;
  console.log("68.3 inbox: " + JSON.stringify(out));
  const g = groups(out);
  expect(g.get("werk-chat")).toEqual(["chat one", "chat two"]);
  expect(g.get("visual")).toEqual(["visual one"]);
});

test("68.4", async () => {
  const p = freshProject();
  seed(p, { id: "visual", kind: "card", title: "Visual" });
  await ok(p, ["add", "werk-pane", "--title", "The pane", "--parent", "visual"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "supported_by"]).catch(async () => {});
  const r = await p.werk(["say", "werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const out = (await ok(p, ["inbox"])).out;
  console.log("68.4 inbox: " + JSON.stringify(out));
  expect(groups(out).get("werk-pane")).toEqual(["Describe the pane here"]);
});

test("68.5", async () => {
  const p = freshProject();
  seed(p, { id: "werk-chat", kind: "card", title: "Chat" });
  const size = readFileSync(logOf(p), "utf8").length;
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("unknown node #no-such-card");
  expect(readFileSync(logOf(p), "utf8").length).toBe(size);
  expect((await ok(p, ["inbox"])).out).not.toContain("lost note");
});
