// Held-out binder C: steps 11.x (show rollups and proof), 12.x and 67.x (quote).
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function seed(p: Project, type: string, payload: Record<string, unknown>) {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type, payload })}\n`);
}

function card(p: Project, id: string, status: string, parent?: string, extra: Record<string, unknown> = {}) {
  seed(p, "node.added", {
    id,
    kind: "card",
    title: `Title ${id}`,
    why: `Why ${id}`,
    status,
    who: "me",
    ...(parent === undefined ? {} : { parent }),
    ...extra,
  });
}

type Msg = { speaker: string; kind: string; text: string; at?: string; session?: string };
function chat(p: Project, name: string, msgs: Msg[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${msgs.map((m, i) => JSON.stringify({ speaker: m.speaker, at: m.at ?? `t${i}`, session: m.session ?? "sess-1", kind: m.kind, text: m.text })).join("\n")}\n`,
  );
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

// ---------- 11.x show ----------

test("11.1", async () => {
  const p = freshProject();
  card(p, "root", "decided");
  card(p, "a", "open", "root");
  card(p, "b", "proto", "root");
  card(p, "g", "decided", "a");
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toEqual(["subtree: 4 cards, 1 open, 1 proto, 2 decided"]);
  expect(1 + 1 + 2).toBe(4);
});

test("11.2", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "child", "open", "root");
  card(p, "g1", "open", "child");
  card(p, "g2", "decided", "child");
  const out = (await ok(p, ["show", "root"])).out;
  const row = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(row).toBeDefined();
  expect(row).toContain("(3 cards, 2 open, 1 decided)");
  expect(out).toContain("subtree: 4 cards, 3 open, 1 decided\n");
});

test("11.3", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "base", "decided", "root");
  card(p, "c", "open", "root");
  chat(p, "conv", [{ speaker: "person", kind: "spoken", text: "we bill per seat every month" }]);
  await ok(p, ["link", "c", "base", "--type", "depends_on", "--why", "c needs the base billing unit"]);
  await ok(p, [
    "add",
    "c:opt0",
    "--kind",
    "option",
    "--title",
    "Bill per account",
    "--why_not",
    "Accounts hide seat growth",
  ]);
  await ok(p, ["link", "c:opt0", "c", "--type", "alternative_to"]);
  await ok(p, ["quote", "c", "conv", "bill per seat"]);
  await ok(p, [
    "add",
    "survey",
    "--kind",
    "source",
    "--title",
    "Customer survey",
    "--finding",
    "Most teams pay per seat",
  ]);
  await ok(p, ["link", "c", "survey", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "c"])).out;
  const ls = out.split("\n");
  const dep = ls.findIndex((l) => l.includes("-> depends_on") && l.includes("base"));
  expect(dep).toBeGreaterThan(-1);
  expect(ls[dep + 1]).toContain("why: c needs the base billing unit");
  const lastLink = Math.max(...ls.map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  const opts = ls.indexOf("Options");
  expect(opts).toBeGreaterThan(lastLink);
  expect(out).toContain("Options\n  c:opt0  Bill per account");
  expect(out).toContain("why not: Accounts hide seat growth");
  expect(out).toContain('Say\n  c:ex0  person: "bill per seat"');
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  expect(ls[ev + 1]).toContain("survey  Customer survey");
  expect(ls[ev + 1]).toContain("proposed");
  expect(ls[ev + 2]).toContain("finding: Most teams pay per seat");
});

test("11.4", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "c", "open", "root");
  chat(p, "conv", [{ speaker: "person", kind: "spoken", text: "we bill per seat every month" }]);
  await ok(p, ["quote", "c", "conv", "bill per seat"]);
  await ok(p, [
    "add",
    "survey",
    "--kind",
    "source",
    "--title",
    "Customer survey",
    "--finding",
    "Most teams pay per seat",
  ]);
  await ok(p, ["link", "c", "survey", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "c"])).out;
  expect(out.split("\n")).toContain("Say");
  expect(out.split("\n")).toContain("Ev");
  expect(out).not.toContain("Options");
});

test("11.5", async () => {
  const p = freshProject();
  card(p, "root", "open", undefined, { title: "The root card" });
  card(p, "second", "decided", "root", { title: "The second card" });
  const out = (await ok(p, ["show"])).out;
  expect(out).toStartWith("card root  [open]\nThe root card\n");
  expect(out).toContain("subtree: 2 cards, 1 open, 1 decided\n");
  expect(out).toContain("<- refines         second  The second card  (1 card, 1 decided)");
});

// ---------- 12.x quote ----------

const LOGS: Msg[] = [
  { speaker: "agent", kind: "tool_result", text: "one log per conversation", at: "10:00" },
  { speaker: "person", kind: "spoken", text: "how do we store a chat?", at: "10:01" },
  { speaker: "agent", kind: "spoken", text: "we keep one log per conversation and never rewrite it", at: "10:02" },
];

test("12.1", async () => {
  const p = freshProject();
  card(p, "root", "open");
  chat(p, "logs", LOGS);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "store", "logs", "one log per conversation"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before + 1);
  const ev = JSON.parse(after.at(-1) as string);
  expect(ev.payload.card).toBe("store");
  expect(ev.payload.id).toBe("store:ex0");
  const cardOut = (await ok(p, ["show", "store"])).out;
  expect(cardOut.match(/-> supported_by/g)?.length).toBe(1);
  expect(cardOut).toContain("-> supported_by    store:ex0  one log per conversation  (ghost, held)");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toStartWith("excerpt store:ex0  [open]  proposed\none log per conversation\n");
  expect(ex).toContain("speaker: agent\n");
  expect(ex).toContain("said at: 10:02\n");
  expect(ex).toContain("session: sess-1\n");
  const idx = LOGS[2]?.text.indexOf("one log per conversation") as number;
  expect(ex).toContain(`span: ${idx}..${idx + "one log per conversation".length}\n`);
  // Step: message position is 3 (the hidden tool result line counts).
  expect(ex).toContain("message: 3\n");
});

test("12.2", async () => {
  const p = freshProject();
  card(p, "root", "open");
  chat(p, "c", [
    { speaker: "person", kind: "spoken", text: "ship the reader first" },
    { speaker: "agent", kind: "spoken", text: "ok, ship the reader first then" },
    { speaker: "person", kind: "spoken", text: "retry, then retry again" },
  ]);
  await ok(p, ["add", "k", "--title", "K", "--parent", "root"]);
  const before = lines(p);
  const showBefore = (await ok(p, ["show", "k"])).out;
  const a = await p.werk(["quote", "k", "c", "ship the reader first"]);
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("in 2 messages");
  const b = await p.werk(["quote", "k", "c", "retry"]);
  expect(b.code).not.toBe(0);
  expect(b.err).toContain("2 times in message 2");
  const c = await p.werk(["quote", "k", "c", "a sentence nobody said"]);
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "k"])).out).toBe(showBefore);
  expect((await p.werk(["show", "k:ex0"])).code).toBe(1);
});

test("12.3", async () => {
  const p = freshProject();
  card(p, "root", "open");
  chat(p, "c", [
    { speaker: "agent", kind: "tool_call", text: "run job; expect exit code 137 maybe" },
    { speaker: "agent", kind: "tool_result", text: "exit code 137 from the runner" },
    { speaker: "agent", kind: "tooling", text: "note: exit code 137 seen" },
    { speaker: "person", kind: "spoken", text: "why did the job die?" },
  ]);
  await ok(p, ["add", "k", "--title", "K", "--parent", "root"]);
  const before = lines(p);
  const run = await p.werk(["quote", "k", "c", "exit code 137"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toEqual(before);
  expect((await p.werk(["show", "k:ex0"])).code).toBe(1);
});

test("12.4", async () => {
  const p = freshProject();
  card(p, "root", "open");
  chat(p, "logs", LOGS);
  await ok(p, ["add", "store", "--title", "One log per conversation", "--parent", "root"]);
  await ok(p, ["quote", "store", "logs", "one log per conversation"]);
  const before = lines(p);
  const exBefore = (await ok(p, ["show", "store:ex0"])).out;
  const add = await p.werk(["add", "store:ex1", "--kind", "excerpt", "--title", "my own words"]);
  expect(add.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["retitle", "store:ex0", "other words"]);
  expect(retitle.code).not.toBe(0);
  const edit = await p.werk(["edit", "store:ex0", "--body", "other words"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "store:ex0"])).out).toBe(exBefore);
  await ok(p, ["say", "store:ex0", "Is this the right quote?"]);
  expect((await ok(p, ["show", "store:ex0"])).out).toContain("Is this the right quote?");
  await ok(p, ["accept", "store", "--actor", "you"]);
  const n = lines(p).length;
  const edit2 = await p.werk(["edit", "store:ex0", "--body", "other words"]);
  expect(edit2.code).not.toBe(0);
  const retitle2 = await p.werk(["retitle", "store:ex0", "other words"]);
  expect(retitle2.code).not.toBe(0);
  expect(lines(p)).toHaveLength(n);
  expect((await ok(p, ["show", "store:ex0"])).out).toContain("\none log per conversation\n");
});

test("12.5", async () => {
  const p = freshProject();
  card(p, "root", "open");
  chat(p, "logs", LOGS);
  await ok(p, ["add", "first", "--title", "First", "--parent", "root"]);
  await ok(p, ["quote", "first", "logs", "one log per conversation"]);
  await ok(p, ["add", "second", "--title", "Second", "--parent", "root"]);
  await ok(p, ["quote", "second", "logs", "one log per conversation"]);
  const exBefore = (await ok(p, ["show", "second:ex0"])).out;
  await ok(p, ["discard", "first"]);
  expect((await p.werk(["show", "first"])).code).toBe(1);
  expect((await p.werk(["show", "first:ex0"])).code).toBe(1);
  await ok(p, ["accept", "second", "--actor", "you"]);
  const head = (await ok(p, ["show", "second"])).out.split("\n")[0] as string;
  expect(head).not.toContain("proposed");
  const ex = (await ok(p, ["show", "second:ex0"])).out;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  // The pointer block (words, speaker, time, session, message, span) is unchanged.
  const pointer = (s: string) => s.split("\n").slice(1, 8).join("\n");
  expect(pointer(ex)).toBe(pointer(exBefore));
  expect(pointer(ex)).toContain("session: sess-1");
});

// ---------- 67.x quote ----------

test("67.1", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "werk-excerpt", "open", "root");
  const said = "Every quote in the imported map was written from memory";
  chat(p, "s1", [
    { speaker: "assistant", kind: "spoken", text: "hello" },
    { speaker: "user", kind: "spoken", text: said, session: "sess-67" },
  ]);
  const run = await p.werk(["quote", "#werk-excerpt", "s1", "written from memory"]);
  expect(run.code).toBe(0);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("session: sess-67\n");
  expect(ex).toContain("message: 1\n");
  expect(ex).toContain("speaker: user\n");
  const s = said.indexOf("written from memory");
  expect(ex).toContain(`span: ${s}..${s + "written from memory".length}\n`);
  expect((await ok(p, ["show", "werk-excerpt"])).out).toContain("-> supported_by    werk-excerpt:ex0");
});

test("67.2", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "werk-excerpt", "open", "root");
  chat(p, "s2", [
    { speaker: "user", kind: "spoken", text: "how do we cite?" },
    { speaker: "assistant", kind: "tool_call", text: "grep cite" },
    { speaker: "assistant", kind: "spoken", text: "We cite the transcript, word for word, with a pointer." },
  ]);
  await ok(p, ["quote", "werk-excerpt", "s2", "word for word, with a pointer"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  const field = (name: string) => ex.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] as string;
  const conv = field("conversation");
  const msg = Number(field("message"));
  const [start, end] = field("span").split("..").map(Number) as [number, number];
  const transcript = readFileSync(join(p.dir, ".werk", "chats", `${conv}.jsonl`), "utf8").split("\n");
  const line = JSON.parse(transcript[msg] as string);
  expect(line.text.slice(start, end)).toBe("word for word, with a pointer");
  expect(line.speaker).toBe("assistant");
  expect(field("speaker")).toBe("assistant");
});

test("67.3", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "k", "open", "root");
  chat(p, "s3", [{ speaker: "user", kind: "spoken", text: "the tool never guesses at a match" }]);
  const before = lines(p).length;
  const run = await p.werk(["quote", "k", "s3", "the tool never gueses"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("no exact match");
  expect(lines(p)).toHaveLength(before);
  expect((await p.werk(["show", "k:ex0"])).code).toBe(1);
});

test("67.4", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "k", "open", "root");
  const msgs: Msg[] = Array.from({ length: 9 }, (_, i) => ({ speaker: "user", kind: "spoken", text: `filler ${i}` }));
  msgs[3] = { speaker: "user", kind: "spoken", text: "the reader fails instead of guessing" };
  msgs[7] = { speaker: "assistant", kind: "spoken", text: "yes, it fails instead of guessing" };
  chat(p, "s4", msgs);
  const before = lines(p).length;
  const run = await p.werk(["quote", "k", "s4", "fails instead of guessing"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("(3, 7)");
  expect(lines(p)).toHaveLength(before);
  expect((await p.werk(["show", "k:ex0"])).code).toBe(1);
});

test("67.5", async () => {
  const p = freshProject();
  card(p, "root", "open");
  card(p, "werk-excerpt", "open", "root");
  chat(p, "s5", [{ speaker: "user", kind: "spoken", text: "quote it once and only once" }]);
  await ok(p, ["quote", "werk-excerpt", "s5", "only once"]);
  expect((await ok(p, ["show", "werk-excerpt:ex0"])).out.split("\n")[0]).toContain("proposed");
  await ok(p, ["accept", "werk-excerpt:ex0", "--actor", "you"]);
  const ex = (await ok(p, ["show", "werk-excerpt:ex0"])).out;
  expect(ex.split("\n")[0]).toBe("excerpt werk-excerpt:ex0  [open]");
  const c = (await ok(p, ["show", "werk-excerpt"])).out;
  expect(c).toContain("  -> supported_by    werk-excerpt:ex0  only once\n");
  expect(c).not.toContain("(ghost, held)");
});
