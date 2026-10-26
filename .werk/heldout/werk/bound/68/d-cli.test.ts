// Held-out binder tests, group D (command line): notes (68), show (11), quote (12, 67).
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

function seed(p: Project, type: string, payload: object): void {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type, payload })}\n`);
}
const card = (p: Project, id: string, fields: Record<string, unknown> = {}) =>
  seed(p, "node.added", { id, kind: "card", title: id, ...fields });

async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

function chat(p: Project, name: string, msgs: { speaker: string; kind: string; text: string; at?: string }[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    msgs.map((m, i) => JSON.stringify({ session: "sess-42", at: m.at ?? `10:0${i}`, ...m })).join("\n") + "\n",
  );
}

// ---------- 68 notes from the agent ----------

test("68.1 an agent writes a note on a card and sees it on the card", async () => {
  const p = freshProject();
  card(p, "werk-chat", { title: "The composer sends a live agent turn", status: "decided", who: "me" });
  const before = lines(p).length;
  const r = await p.werk(["say", "#werk-chat", "The reply streams over SSE"]);
  expect(r.code).toBe(0);
  const after = events(p);
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "note.added", payload: { id: "werk-chat" } });
  const show = await ok(p, ["show", "#werk-chat"]);
  expect(show.out).toContain("The reply streams over SSE");
});

/** The block of inbox output that follows a header line naming `#id`. */
function group(out: string, id: string): string {
  const parts = out.split(/^(?=\S)/m);
  return parts.filter((part) => part.split("\n")[0]?.includes(`#${id}`)).join("");
}

test("68.2 an agent reads a whole card thread in order from the inbox", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  for (const t of ["first", "second", "third"]) await ok(p, ["say", "werk-chat", t]);
  const out = (await ok(p, ["inbox"])).out;
  expect(out).toContain("#werk-chat");
  const g = group(out, "werk-chat");
  const a = g.indexOf("first");
  const b = g.indexOf("second");
  const c = g.indexOf("third");
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  expect(c).toBeGreaterThan(b);
});

test("68.3 the inbox groups notes by card", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  card(p, "visual");
  await ok(p, ["say", "werk-chat", "chat one"]);
  await ok(p, ["say", "visual", "visual one"]);
  await ok(p, ["say", "werk-chat", "chat two"]);
  const out = (await ok(p, ["inbox"])).out;
  const chatGroup = group(out, "werk-chat");
  const visualGroup = group(out, "visual");
  expect(chatGroup).toContain("chat one");
  expect(chatGroup.indexOf("chat two")).toBeGreaterThan(chatGroup.indexOf("chat one"));
  expect(visualGroup).toContain("visual one");
  expect(visualGroup).not.toContain("chat one");
  expect(visualGroup).not.toContain("chat two");
});

test("68.4 an agent writes a note on a ghost card", async () => {
  const p = freshProject();
  card(p, "visual");
  await ok(p, ["add", "werk-pane", "--title", "The pane", "--parent", "visual"]);
  await ok(p, ["link", "visual", "werk-pane", "--type", "supported_by"]).catch(() => undefined);
  const r = await p.werk(["say", "#werk-pane", "Describe the pane here"]);
  expect(r.code).toBe(0);
  const out = (await ok(p, ["inbox"])).out;
  expect(group(out, "werk-pane")).toContain("Describe the pane here");
});

test("68.5 a note on an unknown card fails and changes nothing", async () => {
  const p = freshProject();
  card(p, "werk-chat");
  const size = readFileSync(logOf(p), "utf8").length;
  const r = await p.werk(["say", "#no-such-card", "lost note"]);
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toMatch(/unknown[^\n]*#no-such-card|#no-such-card[^\n]*unknown/);
  expect(readFileSync(logOf(p), "utf8").length).toBe(size);
  expect((await ok(p, ["inbox"])).out).not.toContain("lost note");
});

// ---------- 11 show ----------

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root", status: "decided", who: "me" });
  card(p, "a", { parent: "root" });
  card(p, "b", { parent: "root", status: "proto" });
  card(p, "g", { parent: "a", status: "decided", who: "me" });
  const out = (await ok(p, ["show", "root"])).out;
  const roll = out.split("\n").filter((l) => /^subtree:/.test(l));
  expect(roll).toHaveLength(1);
  const line = roll[0] as string;
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
  const n = (re: RegExp) => Number(re.exec(line)?.[1] ?? 0);
  expect(n(/(\d+) open/) + n(/(\d+) proto/) + n(/(\d+) decided/)).toBe(n(/(\d+) cards?/));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = freshProject();
  card(p, "parent", { title: "Parent" });
  card(p, "child", { title: "Child", parent: "parent" });
  card(p, "g1", { parent: "child" });
  card(p, "g2", { parent: "child", status: "decided", who: "me" });
  const out = (await ok(p, ["show", "parent"])).out;
  const link = out.split("\n").find((l) => /<- refines\s+child/.test(l)) ?? "";
  expect(link).not.toBe("");
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  expect(out).toMatch(/^subtree: 4 cards/m);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  card(p, "basis", { title: "Basis", parent: "root", status: "decided", who: "me" });
  card(p, "c", { title: "C", parent: "root" });
  await ok(p, ["link", "c", "basis", "--type", "depends_on", "--why", "C reuses the basis store"]);
  await ok(p, ["add", "c:opt0", "--kind", "option", "--title", "Use files", "--why_not", "files lose writes"]);
  await ok(p, ["link", "c:opt0", "c", "--type", "alternative_to"]);
  chat(p, "talk", [{ speaker: "person", kind: "spoken", text: "we never lose a write" }]);
  await ok(p, ["quote", "c", "talk", "we never lose a write"]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Bench notes", "--finding", "writes hold at 10k/s"]);
  await ok(p, ["link", "c", "src1", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "c"])).out;
  expect(out).toMatch(/-> depends_on\s+basis/);
  expect(out).toContain("C reuses the basis store");
  const lastLink = Math.max(...[...out.matchAll(/^ {2}[<-]-?>? ?\w+/gm)].map((m) => m.index ?? 0));
  const opts = out.indexOf("\nOptions\n");
  expect(opts).toBeGreaterThan(lastLink);
  const optSection = out.slice(opts);
  expect(optSection).toContain("Use files");
  expect(optSection).toContain("files lose writes");
  expect(out).toMatch(/\nSay\n[\s\S]*person[\s\S]*"we never lose a write"/);
  const ev = out.slice(out.indexOf("\nEv\n"));
  expect(out.indexOf("\nEv\n")).toBeGreaterThan(0);
  expect(ev).toContain("Bench notes");
  expect(ev).toContain("writes hold at 10k/s");
  expect(ev.split("\n").find((l) => l.includes("Bench notes"))).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = freshProject();
  card(p, "c", { title: "C" });
  chat(p, "talk", [{ speaker: "person", kind: "spoken", text: "keep it simple" }]);
  await ok(p, ["quote", "c", "talk", "keep it simple"]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Notes", "--finding", "simple wins"]);
  await ok(p, ["link", "c", "src1", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "c"])).out;
  expect(out).toMatch(/^Say$/m);
  expect(out).toMatch(/^Ev$/m);
  expect(out).not.toMatch(/^Options$/m);
});

test("11.5 show with no id prints the root card", async () => {
  const p = freshProject();
  card(p, "root", { title: "The Root Title" });
  card(p, "second", { title: "Second", parent: "root" });
  const out = (await ok(p, ["show"])).out;
  expect(out).toContain("The Root Title");
  expect(out).toMatch(/^subtree: 2 cards/m);
  expect(out).toMatch(/<- refines\s+second\s+Second\s+\(1 card, 1 open\)/);
});

// ---------- 12 quote ----------

function logsChat(p: Project): void {
  chat(p, "logs", [
    { speaker: "agent", kind: "tool_result", text: "one log per conversation", at: "10:00" },
    { speaker: "person", kind: "spoken", text: "how do we store a chat?", at: "10:01" },
    { speaker: "agent", kind: "spoken", text: "we keep one log per conversation and never rewrite it", at: "10:02" },
  ]);
}

test("12.1 a unique quote becomes an excerpt ghost linked from the citing card", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  logsChat(p);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(r.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.payload).toMatchObject({ card: "store", title: "one log per conversation" });
  const showCard = (await ok(p, ["show", "store"])).out;
  const exLines = showCard.split("\n").filter((l) => /-> supported_by/.test(l));
  expect(exLines).toHaveLength(1);
  const exId = /supported_by\s+(\S+)/.exec(exLines[0] as string)?.[1] as string;
  const ex = (await ok(p, ["show", exId])).out;
  expect(ex).toMatch(/proposed/);
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("10:02");
  expect(ex).toContain("sess-42");
  const text = "we keep one log per conversation and never rewrite it";
  const start = text.indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(ex).toContain("message: 3");
});

test("12.2 a quote that is not unique fails, says which case it found, and writes nothing", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  chat(p, "plan", [
    { speaker: "person", kind: "spoken", text: "ship the reader first" },
    { speaker: "agent", kind: "spoken", text: "agreed, ship the reader first" },
    { speaker: "person", kind: "spoken", text: "retry, then retry again" },
  ]);
  await ok(p, ["add", "reader", "--title", "Reader first", "--parent", "root"]);
  const before = lines(p);
  const showBefore = (await ok(p, ["show", "reader"])).out;
  const a = await p.werk(["quote", "reader", "plan", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.werk(["quote", "reader", "plan", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 (matches|times) in (one )?message/);
  const c = await p.werk(["quote", "reader", "plan", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toMatch(/no (exact )?match/);
  expect((await ok(p, ["show", "reader"])).out).toBe(showBefore);
  expect(lines(p)).toEqual(before);
});

test("12.3 text that appears only in tool output is never quotable", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  chat(p, "run", [
    { speaker: "agent", kind: "tool_call", text: "check exit code 137" },
    { speaker: "agent", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", kind: "tooling", text: "note: exit code 137 seen" },
    { speaker: "person", kind: "spoken", text: "why did the runner die?" },
  ]);
  await ok(p, ["add", "oom", "--title", "Runner OOM", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["quote", "oom", "run", "exit code 137"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no (exact )?match/);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "oom"])).out).not.toContain("supported_by");
});

test("12.4 an excerpt's words cannot be written or changed by hand", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  logsChat(p);
  await ok(p, ["add", "store", "--title", "One log", "--parent", "root"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const ex = "store:ex0";
  let before = lines(p);
  const plain = await p.werk(["add", "store:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(plain.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["retitle", ex, "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["edit", ex, "--body", "other words"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
  const say = await p.werk(["say", ex, "is this right?"]);
  expect(say.code).toBe(0);
  expect((await ok(p, ["show", ex])).out).toContain("is this right?");
  await ok(p, ["accept", "store", "--actor", "you"]);
  before = lines(p);
  const edit2 = await p.werk(["edit", ex, "--body", "other words"]);
  expect(edit2.code).not.toBe(0);
  const retitle2 = await p.werk(["retitle", ex, "other words"]);
  expect(retitle2.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", ex])).out.split("\n")[1]).toBe("one log per conversation");
});

test("12.5 the excerpt follows the fate of its citing card", async () => {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  logsChat(p);
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "second", "logs", "never rewrite it"]);
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).not.toBe(0);
  expect((await p.werk(["show", "first:ex0"])).code).not.toBe(0);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const c = (await ok(p, ["show", "second"])).out;
  expect(c.split("\n")[0]).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const s of ["never rewrite it", "speaker: agent", "10:02", "sess-42", "message: 2", `span: ${T.indexOf("never rewrite it")}..${T.indexOf("never rewrite it") + 16}`])
    expect(ex).toContain(s);
});

const T = "we keep one log per conversation and never rewrite it";

// ---------- 67 quote from a recorded session ----------

test("67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card", async () => {
  const p = freshProject();
  card(p, "werk-excerpt", { title: "Excerpts" });
  chat(p, "s67", [
    { speaker: "assistant", kind: "spoken", text: "hello" },
    { speaker: "user", kind: "spoken", text: "Every quote in the imported map was written from memory" },
  ]);
  const r = await p.werk(["quote", "#werk-excerpt", "s67", "written from memory"]);
  expect(r.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  const text = "Every quote in the imported map was written from memory";
  const start = text.indexOf("written from memory");
  for (const s of ["sess-42", "message: 1", "speaker: user", `span: ${start}..${start + 19}`]) expect(ex).toContain(s);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toMatch(/-> supported_by\s+werk-excerpt:ex0/);
});

test("67.2 the excerpt lets the person find the quote again in the transcript", async () => {
  const p = freshProject();
  card(p, "werk-excerpt", { title: "Excerpts" });
  const msgs = [
    { speaker: "user", kind: "spoken", text: "how do we cite?" },
    { speaker: "assistant", kind: "tool_call", text: "read file" },
    { speaker: "assistant", kind: "spoken", text: "We cite by pointer, and the pointer is exact to the character." },
  ];
  chat(p, "s672", msgs);
  await ok(p, ["quote", "werk-excerpt", "s672", "the pointer is exact"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const message = Number(/message: (\d+)/.exec(ex)?.[1]);
  const [, s, e] = /span: (\d+)\.\.(\d+)/.exec(ex) ?? [];
  const transcript = readFileSync(join(p.dir, ".werk", "chats", "s672.jsonl"), "utf8").split("\n");
  const line = JSON.parse(transcript[message] as string);
  expect(line.text.slice(Number(s), Number(e))).toBe("the pointer is exact");
  expect(line.speaker).toBe("assistant");
  expect(ex).toContain("speaker: assistant");
});

test("67.3 a quote with one changed character fails and changes nothing", async () => {
  const p = freshProject();
  card(p, "c", { title: "C" });
  chat(p, "s673", [{ speaker: "user", kind: "spoken", text: "the tool never guesses" }]);
  const before = lines(p).length;
  const r = await p.werk(["quote", "c", "s673", "the tool never gueses"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/no exact match/);
  expect(lines(p)).toHaveLength(before);
  expect((await ok(p, ["show", "c"])).out).not.toContain("supported_by");
});

test("67.4 a quote that occurs in two messages fails and names both messages", async () => {
  const p = freshProject();
  card(p, "c", { title: "C" });
  const msgs = Array.from({ length: 9 }, (_, i) => ({
    speaker: i % 2 ? "assistant" : "user",
    kind: "spoken",
    text: i === 3 || i === 7 ? `it fails instead of guessing, line ${i}` : `filler ${i}`,
  }));
  chat(p, "s674", msgs);
  const before = lines(p).length;
  const r = await p.werk(["quote", "c", "s674", "fails instead of guessing"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toMatch(/\b3\b/);
  expect(r.err).toMatch(/\b7\b/);
  expect(lines(p)).toHaveLength(before);
  expect((await ok(p, ["show", "c"])).out).not.toContain("supported_by");
});

test("67.5 a ghost excerpt is accepted the same way as every other ghost", async () => {
  const p = freshProject();
  card(p, "c", { title: "C" });
  chat(p, "s675", [{ speaker: "user", kind: "spoken", text: "accept it like any ghost" }]);
  await ok(p, ["quote", "c", "s675", "like any ghost"]);
  expect((await ok(p, ["show", "c:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "c:ex0", "--actor", "you"]);
  expect((await ok(p, ["show", "c:ex0"])).out.split("\n")[0]).not.toContain("proposed");
  const show = (await ok(p, ["show", "c"])).out;
  const link = show.split("\n").find((l) => /-> supported_by\s+c:ex0/.test(l)) ?? "";
  expect(link).not.toBe("");
  expect(link).not.toContain("held");
});
