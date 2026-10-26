// Held-out steps 64.x (contract check), 12.x (quote and excerpts) and 26.x (ticket-check).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type P, proj } from "./h.ts";

// ---------- helpers ----------

/** Splits a printed command line into arguments, with double-quoted parts kept whole. */
function argv(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? (m[2] as string));
  return out;
}

/** Fills the placeholders of a printed fix command. */
function fill(line: string, card: string): string {
  return line
    .replaceAll("<card>", card)
    .replace(/you\|me\|prototype/, "you")
    .replace(/"<[^"]*>"/g, '"filled by the binder"');
}

/** The printed command lines of a refusal, without their "or:"/"then:" prefixes, grouped by fact. */
function fixes(err: string): { fact: string; cmds: string[] }[] {
  const out: { fact: string; cmds: string[] }[] = [];
  for (const line of err.split("\n")) {
    const fact = /^ {2}(who|basis|option|kill criterion): /.exec(line);
    if (fact) out.push({ fact: fact[1] as string, cmds: [] });
    const cmd = /^ {4}(?:(or|then): )?(werk .*)$/.exec(line);
    if (cmd && out.length > 0) (out.at(-1) as { cmds: string[] }).cmds.push(`${cmd[1] ?? ""}|${cmd[2]}`);
  }
  return out;
}

const runPrinted = (p: P, line: string) => p.ok(...argv(line).slice(1));

const decidedBase = (p: P) => {
  p.seed("node.added", {
    id: "base",
    kind: "card",
    title: "Base",
    status: "decided",
    who: "me",
    no_basis: "the top",
  });
  p.seed("kill.added", { id: "base", criterion: { form: "revisit" } });
  p.seed("node.added", {
    id: "dep",
    kind: "card",
    title: "Dep",
    status: "decided",
    who: "me",
    parent: "base",
  });
  p.seed("kill.added", { id: "dep", criterion: { form: "revisit" } });
};

// ---------- 64 ----------

test("64.1", async () => {
  const p = proj();
  decidedBase(p);
  p.seed("node.added", { id: "c", kind: "card", title: "C", who: "you", parent: "base" });
  p.seed("edge.added", { from: "c", to: "dep", type: "depends_on", why: "C reads Dep" });
  p.seed("node.added", { id: "c:opt0", kind: "option", title: "Other", why_not: "slower" });
  p.seed("edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  expect((await p.ok("show", "c")).split("\n")[0]).toContain("[open]");
  const before = p.log();
  const r = await p.w("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const groups = fixes(r.err);
  expect(groups.map((g) => g.fact)).toEqual(["kill criterion"]);
  expect(r.err).toContain("kill criterion");
  const cmds = (groups[0] as { cmds: string[] }).cmds.map((c) => c.split("|")[1] as string);
  expect(cmds.some((c) => c.startsWith("werk kill c"))).toBe(true);
  expect((await p.ok("show", "c")).split("\n")[0]).toContain("[open]");
  expect(p.log()).toEqual(before);
  // The printed command with no placeholder: revisit at any time.
  const exact = cmds.find((c) => !c.includes("<")) as string;
  await runPrinted(p, exact);
  await p.ok("status", "c", "decided");
  expect((await p.ok("show", "c")).split("\n")[0]).toContain("[decided]");
});

test("64.2", async () => {
  const p = proj();
  // A decided card the basis fix can point at, in a separate tree.
  p.seed("node.added", { id: "b", kind: "card", title: "B", status: "decided", who: "me", no_basis: "top" });
  p.seed("kill.added", { id: "b", criterion: { form: "revisit" } });
  p.seed("node.added", { id: "x", kind: "card", title: "X", body: "Some body." });
  const r = await p.w("status", "x", "decided");
  expect(r.code).not.toBe(0);
  const groups = fixes(r.err);
  expect(groups.map((g) => g.fact)).toEqual(["who", "basis", "option", "kill criterion"]);
  for (const g of groups) expect(g.cmds.length).toBeGreaterThan(0);
  expect((await p.ok("show", "x")).split("\n")[0]).toContain("[open]");
  for (const g of groups) {
    // The first printed command of each fact, and its "then:" follow-up.
    const first = g.cmds[0] as string;
    const chosen = [first, ...g.cmds.slice(1).filter((c) => c.startsWith("then|"))];
    for (const c of chosen) await runPrinted(p, fill(c.split("|")[1] as string, "b"));
  }
  await p.ok("status", "x", "decided");
  expect((await p.ok("show", "x")).split("\n")[0]).toContain("[decided]");
});

test("64.3", async () => {
  const p = proj();
  decidedBase(p);
  await p.ok("add", "g1", "--title", "G1", "--who", "you");
  await p.ok("link", "g1", "dep", "--type", "depends_on", "--why", "G1 reads Dep");
  await p.ok("add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower");
  await p.ok("link", "g1:opt0", "g1", "--type", "alternative_to");
  await p.ok("kill", "g1", "--revisit");
  await p.ok("add", "g2", "--title", "G2", "--who", "you");
  await p.ok("add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower");
  await p.ok("link", "g2:opt0", "g2", "--type", "alternative_to");
  await p.ok("kill", "g2", "--revisit");
  expect((await p.ok("show", "g2")).split("\n")[0]).toContain("proposed");
  await p.ok("status", "g1", "decided");
  expect((await p.ok("show", "g1")).split("\n")[0]).toContain("[decided]");
  const r = await p.w("status", "g2", "decided");
  expect(r.code).not.toBe(0);
  const groups = fixes(r.err);
  expect(groups.map((g) => g.fact)).toEqual(["basis"]);
  expect(r.err).toContain("depends_on");
  expect((groups[0] as { cmds: string[] }).cmds[0]).toContain("werk link g2 ");
  expect((await p.ok("show", "g2")).split("\n")[0]).not.toContain("[decided]");
});

async function decidedFull(p: P) {
  decidedBase(p);
  p.seed("node.added", {
    id: "c",
    kind: "card",
    title: "C",
    why: "Because.",
    body: "The long first body.",
    who: "you",
  });
  p.seed("edge.added", { from: "c", to: "dep", type: "depends_on", why: "C reads Dep" });
  p.seed("node.added", { id: "c:opt0", kind: "option", title: "Other", why_not: "slower" });
  p.seed("edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  p.seed("kill.added", { id: "c", criterion: { form: "revisit" } });
  p.seed("node.decided", { id: "c" });
  expect((await p.ok("show", "c")).split("\n")[0]).toContain("[decided]");
}

test("64.4", async () => {
  const p = proj();
  await decidedFull(p);
  const before = await p.ok("show", "c");
  const log = p.log();
  const r = await p.w("unlink", "c", "dep", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("basis");
  expect(r.err).toContain("depends_on");
  expect(r.err).toContain("werk link c ");
  expect(p.log()).toEqual(log);
  const after = await p.ok("show", "c");
  expect(after.split("\n")[0]).toContain("[decided]");
  expect(after).toBe(before);
});

test("64.5", async () => {
  const p = proj();
  await decidedFull(p);
  const n = p.log().length;
  await p.ok(
    "propose",
    "c",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "The long first body.", new: "Short." }]),
  );
  await p.ok("accept", "c", "--actor", "you");
  const show = await p.ok("show", "c");
  expect(show.split("\n")[0]).toContain("[decided]");
  expect(show).toContain("Short.");
  const types = p
    .events()
    .slice(n)
    .map((e) => e.type);
  console.log("64.5 new events:", JSON.stringify(p.events().slice(n)));
  // The log must show the amend as a reopen and a decide of the card.
  expect(types.some((t) => /reopen/.test(t))).toBe(true);
  expect(types.some((t) => /decided/.test(t))).toBe(true);
});

// ---------- 12 ----------

const line = (kind: string, text: string, speaker: string, at: string, session = "sess-1") =>
  JSON.stringify({ speaker, at, session, kind, text });

function chat(p: P, name: string, lines: string[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.join("\n")}\n`);
}

function withRoot(p: P) {
  p.seed("node.added", { id: "root", kind: "card", title: "Root" });
}

test("12.1", async () => {
  const p = proj();
  withRoot(p);
  chat(p, "conv", [
    line("tool_result", "ls output", "agent", "10:00"),
    line("spoken", "how do we store a chat?", "person", "10:01"),
    line("spoken", "we keep one log per conversation and never rewrite it", "agent", "10:02"),
  ]);
  await p.ok("add", "store", "--title", "Store chats", "--parent", "root");
  const n = p.log().length;
  const out = await p.ok("quote", "store", "conv", "one log per conversation");
  const id = /^(\S+):/.exec(out)?.[1] as string;
  const card = await p.ok("show", "store");
  expect(card).toContain(`-> supported_by    ${id}`);
  const ex = await p.ok("show", id);
  expect(ex.split("\n")[0]).toContain("proposed");
  expect(ex).toContain("one log per conversation");
  expect(ex).toContain("speaker: agent");
  expect(ex).toContain("said at: 10:02");
  expect(ex).toContain("session: sess-1");
  const start = "we keep one log per conversation and never rewrite it".indexOf("one log per conversation");
  expect(ex).toContain(`span: ${start}..${start + "one log per conversation".length}`);
  expect(p.log().length).toBe(n + 1);
  const ev = p.events().at(-1) as { payload: Record<string, unknown> };
  expect(ev.payload.card).toBe("store");
  // The step: the message position is 3.
  expect(ex).toContain("message: 3");
});

test("12.2", async () => {
  const p = proj();
  withRoot(p);
  chat(p, "c2", [
    line("spoken", "ship the reader first", "person", "1"),
    line("spoken", "ok, ship the reader first", "agent", "2"),
    line("spoken", "retry, then retry again", "person", "3"),
  ]);
  await p.ok("add", "k", "--title", "K", "--parent", "root");
  const before = p.log();
  const a = await p.w("quote", "k", "c2", "ship the reader first");
  expect(a.code).not.toBe(0);
  expect(a.err).toContain("2 messages");
  const b = await p.w("quote", "k", "c2", "retry");
  expect(b.code).not.toBe(0);
  expect(b.err).toMatch(/2 times in message/);
  const c = await p.w("quote", "k", "c2", "a sentence nobody said");
  expect(c.code).not.toBe(0);
  expect(c.err).toContain("no exact match");
  expect(p.log()).toEqual(before);
  expect(await p.ok("show", "k")).not.toContain("supported_by");
  expect((await p.w("show", "k:ex0")).code).not.toBe(0);
});

test("12.3", async () => {
  const p = proj();
  withRoot(p);
  chat(p, "c3", [
    line("tool_call", "run tests; exit code 137", "agent", "1"),
    line("tool_result", "exit code 137 from the runner", "agent", "2"),
    line("tooling", "note: exit code 137", "agent", "3"),
    line("spoken", "the tests failed", "agent", "4"),
  ]);
  await p.ok("add", "k", "--title", "K", "--parent", "root");
  const n = p.log().length;
  const r = await p.w("quote", "k", "c3", "exit code 137");
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("no exact match");
  expect(p.log().length).toBe(n);
  expect((await p.w("show", "k:ex0")).code).not.toBe(0);
});

test("12.4", async () => {
  const p = proj();
  withRoot(p);
  chat(p, "c4", [line("spoken", "we bill per seat", "person", "1")]);
  await p.ok("add", "k", "--title", "K", "--parent", "root");
  const out = await p.ok("quote", "k", "c4", "per seat");
  const id = /^(\S+):/.exec(out)?.[1] as string;
  const words = await p.ok("show", id);
  let log = p.log();
  const add = await p.w("add", "k:ex9", "--kind", "excerpt", "--title", "my own words");
  expect(add.code).not.toBe(0);
  expect(p.log()).toEqual(log);
  const retitle = await p.w("propose", id, "--title", "new words");
  expect(retitle.code).not.toBe(0);
  const edit = await p.w("propose", id, "--ops", JSON.stringify([{ tag: "new", new: "text" }]));
  expect(edit.code).not.toBe(0);
  expect(p.log()).toEqual(log);
  expect(await p.ok("show", id)).toBe(words);
  await p.ok("say", id, "Is this the right quote?");
  expect(p.log().length).toBe(log.length + 1);
  expect(p.events().at(-1)?.payload.id).toBe(id);
  await p.ok("accept", "k", "--actor", "you");
  log = p.log();
  const again = await p.w("propose", id, "--title", "new words");
  expect(again.code).not.toBe(0);
  expect(p.log()).toEqual(log);
  expect(await p.ok("show", id)).toContain("per seat");
});

test("12.5", async () => {
  const p = proj();
  withRoot(p);
  chat(p, "c5", [line("spoken", "we keep one log per conversation", "agent", "10:02")]);
  await p.ok("add", "first", "--title", "First", "--parent", "root");
  const e1 = /^(\S+):/.exec(await p.ok("quote", "first", "c5", "one log"))?.[1] as string;
  await p.ok("add", "second", "--title", "Second", "--parent", "root");
  const e2 = /^(\S+):/.exec(await p.ok("quote", "second", "c5", "one log"))?.[1] as string;
  await p.ok("discard", "first");
  expect((await p.w("show", "first")).code).not.toBe(0);
  expect((await p.w("show", e1)).code).not.toBe(0);
  await p.ok("accept", "second", "--actor", "you");
  expect((await p.ok("show", "second")).split("\n")[0]).not.toContain("proposed");
  const ex = await p.ok("show", e2);
  expect(ex.split("\n")[0]).not.toContain("proposed");
  for (const part of ["one log", "speaker: agent", "said at: 10:02", "session: sess-1", "message: 0", "span: 8..15"])
    expect(ex).toContain(part);
});

// ---------- 26 ----------

const ticket = (o: {
  title?: string;
  cites: string;
  blocked: string;
  stories: string;
  build?: string;
  checks?: string;
}) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked}
stories: ${o.stories}
touches: map view

## What to build

${o.build ?? "A person opens a card and presses reopen."}

## Acceptance criteria

- [ ] The card shows as open.

## Checks

${o.checks ?? ""}`;

function ticketProject(stories: number, extra: (p: P) => void = () => undefined): P {
  const p = proj();
  p.seed("node.added", { id: "top", kind: "card", title: "Top" });
  p.seed("node.added", { id: "d1", kind: "card", title: "D1", parent: "top" });
  p.seed("node.added", { id: "d2", kind: "card", title: "D2", parent: "top" });
  p.seed("node.decided", { id: "top" });
  p.seed("node.decided", { id: "d1" });
  p.seed("node.decided", { id: "d2" });
  extra(p);
  const list = Array.from({ length: stories }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n");
  writeFileSync(join(p.dir, "spec.md"), `# Spec\n\n## User stories\n\n${list}\n\n## Seams\n\nNone.\n`);
  mkdirSync(join(p.dir, "tickets"));
  return p;
}

const put = (p: P, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: P, ...args: string[]) =>
  p.w("ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...args);

const valid = () => ({
  "01-one.md": ticket({ title: "One", cites: "top, d1", blocked: "", stories: "1", checks: "- `make test`\n" }),
  "02-two.md": ticket({ title: "Two", cites: "#d2", blocked: "1", stories: "2" }),
});

test("26.1", async () => {
  const p = ticketProject(2);
  put(p, valid());
  const r = await check(p);
  const lines = r.out.split("\n").filter(Boolean);
  expect(lines.filter((l) => /^(0\d-|ticket set)/.test(l))).toEqual([]);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const p = ticketProject(2);
  const v = valid();
  put(p, v);
  expect((await check(p)).code).toBe(0);
  const first = v["01-one.md"].split("\n");
  // Line 9 of the file is the first line of the What to build section.
  first[8] = "Edit src/loop.ts so the reopen runs, then the Makefile target.";
  const second = v["02-two.md"].replace("presses reopen.", `presses reopen. ${"pad ".repeat(1100)}`);
  expect(second.length).toBeGreaterThan(4000);
  put(p, { "01-one.md": first.join("\n"), "02-two.md": second });
  const r = await check(p);
  const lines = r.out.split("\n").filter(Boolean);
  const failures = lines.slice(0, -1);
  expect(
    failures.some((l) => l.startsWith("01-one.md") && l.includes("no-file-paths") && /line 9\b.*src\/loop\.ts/.test(l)),
  ).toBe(true);
  expect(failures.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(failures.some((l) => l.startsWith("02-two.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(new RegExp(`\\b${failures.length} failures\\b`));
  expect(r.code).toBe(1);
});

test("26.3", async () => {
  const p = ticketProject(3, (q) =>
    q.seed("node.proposed", { id: "gh", kind: "card", title: "Ghost card", parent: "top" }),
  );
  put(p, {
    "01-a.md": ticket({ title: "A", cites: "top, d1", blocked: "", stories: "1" }),
    "02-b.md": ticket({ title: "B", cites: "d1", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "C", cites: "top", blocked: "2", stories: "1, 2" }),
  });
  const r = await check(p);
  const lines = r.out.split("\n").filter(Boolean);
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("d2");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toContain("story 3");
  const cycle = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toContain("02-b.md");
  expect(cycle).toContain("03-c.md");
  expect(lines.filter((l) => l.includes("gh"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const p = proj();
  p.seed("node.added", { id: "top", kind: "card", title: "Top" });
  p.seed("node.added", { id: "d1", kind: "card", title: "D1", parent: "top" });
  p.seed("node.decided", { id: "top" });
  p.seed("node.decided", { id: "d1" });
  writeFileSync(join(p.dir, "spec.md"), "# Spec\n\n## User stories\n\n1. As a person, I want one thing.\n");
  mkdirSync(join(p.dir, "tickets"));
  put(p, { "01-x.md": ticket({ cites: "top, d1", blocked: "", stories: "1" }) });
  const r = await check(p);
  const lines = r.out.split("\n").filter(Boolean);
  const own = lines.filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((l) => /: title: /.test(l) || /^01-x\.md: title\b/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("d1"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && /story 1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = ticketProject(2);
  put(p, valid());
  const missing = await p.w("ticket-check", "tickets", "--root", "top", "--spec", "nope.md");
  expect(missing.out + missing.err).toMatch(/spec/i);
  expect(missing.out + missing.err).toContain("nope.md");
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad.md"), "# Spec\n\n1. A line.\n");
  expect((await p.w("ticket-check", "tickets", "--root", "top", "--spec", "bad.md")).code).toBe(2);
  expect((await p.w("ticket-check", "tickets", "--root", "nope", "--spec", "spec.md")).code).toBe(2);
  expect((await p.w("ticket-check", "tickets", "--spec", "spec.md")).code).toBe(2);
  // Keep the file reader import used.
  expect(readFileSync(join(p.dir, "spec.md"), "utf8")).toContain("User stories");
});
