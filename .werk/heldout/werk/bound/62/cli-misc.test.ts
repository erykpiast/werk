import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  appendLog, boardPath, createProject, decidedCard, logText, openCard, type Project, werkIn, writeLog,
} from "./helpers.ts";

let p: Project;
let w: ReturnType<typeof werkIn>;
beforeEach(() => { p = createProject(); w = werkIn(p); });
afterEach(() => p.dispose());
const all = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

const spoken = (text: string) => ({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text });
function chat(name: string, ...lines: unknown[]) {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
const lineCount = () => logText(p).split("\n").filter(Boolean).length;

// ---------- 06 ----------
test("06.1 + 06.2 excerpt stages as ghost and goes live on accept", async () => {
  writeLog(p, decidedCard("card", "A card"));
  chat("talk", spoken("we want magic links for login"));
  const q = await w("quote", "card", "talk", "magic links for login");
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const shown = (await w("show", "card")).stdout;
  expect(shown).toContain("[decided]");
  expect(shown).toContain("A card");
  expect(shown).toMatch(/Say:\n\s+person: magic links for login\s+proposed/);
  const ex = (await w("show", "card:ex0")).stdout;
  expect(ex).toContain("proposed");
  // accept
  const acc = await w("accept", "card:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const after = (await w("show", "card")).stdout;
  expect(after).toMatch(/Say:\n\s+person: magic links for login\s*(\n|$)/);
  expect(after).not.toMatch(/Say:[\s\S]*proposed/);
  expect((await w("show", "card:ex0")).stdout).not.toContain("proposed");
});

// ---------- 11 ----------
test("11.1 rollup counts card and subtree", async () => {
  writeLog(p, [
    ...decidedCard("root", "Root"),
    ...decidedCard("c1", "Child one", "root"),
    { type: "node.proposed", id: "c2", kind: "card", title: "Child two", status: "proto", why: "w", parent: "root" },
    { type: "node.accepted", id: "c2", actor: "you" },
    ...decidedCard("g", "Grand", "c1"),
  ]);
  expect((await w("reopen", "c1", "--reason", "invalidated", "--why", "x")).code).toBe(0);
  const r = await w("show", "root");
  const rollups = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollups).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 incoming refines link shows child's rollup", async () => {
  writeLog(p, [
    ...openCard("parent", "Parent"),
    ...openCard("child", "Child", "parent"),
    ...openCard("g1", "Grand one", "child"),
    ...decidedCard("g2", "Grand two", "child"),
  ]);
  const r = (await w("show", "parent")).stdout;
  expect(r).toContain("rollup: 4 cards:");
  expect(r).toMatch(/<- refines\s+child\s+Child.*rollup: 3 cards:/);
});

test("11.3 options, say, ev sections", async () => {
  writeLog(p, [
    ...openCard("other", "Other card"),
    ...openCard("card", "The card"),
    { type: "edge.added", from: "card", to: "other", link: "depends_on", why: "needs the token" },
    { type: "node.proposed", id: "opt", kind: "option", title: "Use cookies", status: "open", why: "cookies break on mobile" },
    { type: "node.accepted", id: "opt", actor: "you" },
    { type: "edge.added", from: "opt", to: "card", link: "alternative_to" },
    { type: "node.proposed", id: "src", kind: "source", title: "RFC 6749", status: "open", why: "tokens expire" },
    { type: "edge.added", from: "card", to: "src", link: "supported_by" },
  ]);
  chat("talk", spoken("we want magic links for login"));
  expect((await w("quote", "card", "talk", "magic links for login")).code).toBe(0);
  await w("accept", "card:ex0", "--actor", "you");
  const r = (await w("show", "card")).stdout;
  expect(r).toMatch(/depends_on\s+other/);
  expect(r).toContain("needs the token");
  const iLinks = r.indexOf("needs the token");
  const iOpt = r.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLinks);
  expect(r).toMatch(/Options:\n\s+opt\s+Use cookies\n\s+why not: cookies break on mobile/);
  expect(r).toMatch(/Say:\n\s+person: magic links for login/);
  expect(r).toMatch(/Ev:\n\s+src\s+RFC 6749\s+proposed\n\s+finding: tokens expire/);
});

test("11.4 no options section", async () => {
  writeLog(p, [
    ...openCard("card", "The card"),
    { type: "node.proposed", id: "src", kind: "source", title: "RFC 6749", status: "open", why: "tokens expire" },
    { type: "node.accepted", id: "src", actor: "you" },
    { type: "edge.added", from: "card", to: "src", link: "supported_by" },
  ]);
  chat("talk", spoken("we want magic links for login"));
  await w("quote", "card", "talk", "magic links for login");
  const r = (await w("show", "card")).stdout;
  expect(r).toContain("Say:");
  expect(r).toContain("Ev:");
  expect(r).not.toContain("Options");
});

test("11.5 show with no id prints root card", async () => {
  writeLog(p, [...openCard("root", "The root"), ...openCard("second", "Second card", "root")]);
  const r = (await w("show")).stdout;
  expect(r).toContain("The root");
  expect(r).toContain("rollup:");
  expect(r).toMatch(/<- refines\s+second\s+Second card.*rollup: 1 cards/);
});

// ---------- 43 / 27.3 ----------
const plan = (id: string, title = "Ticket") => ({ type: "ticket.planned", id, title });
function board(events: object[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(p), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
const done = (id: string) => [
  plan(id),
  { type: "ticket.moved", id, to: "building", actor: "loop" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 build miss recorded and listed", async () => {
  board(done("app/01"));
  const r = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = (await w("followup", "app/01", "--list")).stdout;
  expect(l).toMatch(/^1\./);
  expect(l).toContain("build");
  expect(l).toContain("after-merge");
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/catch.*yes/);
});

test("43.2 plan miss without catchable", async () => {
  board(done("app/01"));
  const r = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.stdout).toContain("recorded");
  const l = (await w("followup", "app/01", "--list")).stdout;
  expect(l).toMatch(/^1\. plan/);
  expect(l).toContain("review");
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toMatch(/catch/);
});

test("43.3 wrong catchable answer refused", async () => {
  board(done("app/01"));
  const a = await w("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/build miss needs.*catchable/);
  const b = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/plan miss (has|takes) no catchable/);
  expect((await w("followup", "app/01", "--list")).stdout.trim()).toBe("");
});

test("43.4 not done or unknown ticket refused", async () => {
  board([plan("app/02"), { type: "ticket.moved", id: "app/02", to: "building", actor: "loop" }]);
  const a = await w("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(all(a)).toMatch(/not done/);
  const b = await w("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(all(b)).toMatch(/does not exist|no ticket/);
  expect((await w("followup", "app/02", "--list")).stdout.trim()).toBe("");
});

test("43.5 last correction is in force", async () => {
  board(done("app/01"));
  await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "first reading", "--catchable", "yes");
  const c1 = await w("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await w("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan miss/);
  expect(l1).toMatch(/2\. correction of 1/);
  const c2 = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await w("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build miss/);
});

test("27.3 restore of a non-archived or unknown ticket changes nothing", async () => {
  board([plan("auth/02")]);
  const before = readFileSync(boardPath(p));
  const a = await w("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(readFileSync(boardPath(p)).equals(before)).toBe(true);
  const b = await w("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(readFileSync(boardPath(p)).equals(before)).toBe(true);
});

// ---------- 30 ----------
function files(map: Record<string, string>) {
  for (const [path, text] of Object.entries(map)) {
    mkdirSync(join(p.dir, path, ".."), { recursive: true });
    writeFileSync(join(p.dir, path), text);
  }
}
const check = () => w("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";

test("30.1 correct folder passes", async () => {
  writeLog(p, [...decidedCard("root", "Root"), ...decidedCard("a", "A", "root"), ...decidedCard("b", "B", "root")]);
  files({
    "spec.md": SPEC,
    "tickets/01-a.md": ticket({ cites: "a", stories: "1" }),
    "tickets/02-b.md": ticket({ cites: "b, root", stories: "2", blockedBy: "1" }),
  });
  const r = await check();
  expect(r.code).toBe(0);
  const lines = r.stdout.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatch(/2 tickets, 0 own-check failures, 0 failures, 3 decided cards, 2 stories|2 tickets.*0 own-check failures.*0 failures.*decided cards.*2 stories/);
});

test("30.2 own-check failures", async () => {
  writeLog(p, [...decidedCard("root", "Root")]);
  const body = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "Edit src/loop.ts here."];
  files({
    "spec.md": SPEC,
    "tickets/01-a.md": ticket({ cites: "root", stories: "1,2" }),
    "tickets/02-b.md": ticket({ what: body.join("\n") }),
    "tickets/03-c.md": ticket({ touches: null }),
  });
  const r = await check();
  expect(r.code).toBe(1);
  const out = r.stdout;
  expect(out).toMatch(/02-b\.md.*src\/loop\.ts.*line \d+/);
  expect(out).toMatch(/03-c\.md: shape: touches/);
  expect(out).not.toMatch(/01-a\.md/);
  expect(out.trim().split("\n").at(-1)).toMatch(/3 tickets, 2 own-check failures/);
});

test("30.3 uncited real card, ghost ignored", async () => {
  writeLog(p, [
    ...decidedCard("root", "Root"), ...decidedCard("one", "One", "root"), ...decidedCard("two", "Two", "root"),
    { type: "node.proposed", id: "ghost", kind: "card", title: "Ghost", status: "decided", parent: "root" },
  ]);
  expect((await w("reopen", "root", "--reason", "invalidated", "--why", "x")).code).toBe(0);
  files({
    "spec.md": "## User stories\n\n1. a\n",
    "tickets/01-a.md": ticket({ cites: "root, one", stories: "1" }),
  });
  const r = await check();
  expect(r.code).toBe(1);
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines.length).toBe(1);
  expect(setLines[0]).toContain("two");
  expect(r.stdout).not.toMatch(/ghost/);
  expect(r.stdout.trim().split("\n").at(-1)).toContain("2 decided cards");
});

test("30.4 cycle", async () => {
  writeLog(p, [...decidedCard("root", "Root")]);
  files({
    "spec.md": "## User stories\n\n1. a\n",
    "tickets/01-a.md": ticket({ cites: "root", stories: "1" }),
    "tickets/02-b.md": ticket({ cites: "", blockedBy: "3" }),
    "tickets/03-c.md": ticket({ cites: "", blockedBy: "2" }),
    "tickets/04-d.md": ticket({ cites: "", blockedBy: "3" }),
  });
  const r = await check();
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/02-b\.md: blocked_by/);
  expect(r.stdout).toMatch(/03-c\.md: blocked_by/);
  expect(r.stdout).not.toMatch(/01-a\.md/);
  expect(r.stdout).not.toMatch(/04-d\.md: /);
});

test("30.5 spec without stories heading", async () => {
  writeLog(p, [...decidedCard("root", "Root")]);
  files({ "spec.md": "# Spec\n", "tickets/01-a.md": ticket({ cites: "root" }) });
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});

// ---------- 62 ----------
const nth = (n: number) => logText(p).split("\n").filter(Boolean)[n];
test("62.1 propose then accept", async () => {
  writeLog(p, openCard("base", "Base card"));
  const before = logText(p);
  const add = await w("add", "x", "--title", "Use a log", "--body", "The body text", "--why", "The why text");
  expect(add.stdout.trim()).toBe("proposed");
  const after1 = logText(p);
  expect(after1.startsWith(before)).toBe(true);
  expect(after1.slice(before.length).split("\n").filter(Boolean).length).toBe(1);
  const s1 = (await w("show", "x")).stdout;
  for (const t of ["Use a log", "The body text", "The why text"]) expect(s1).toContain(t);
  expect(s1).toContain("proposed");
  const acc = await w("accept", "x", "--actor", "you");
  expect(acc.code).toBe(0);
  const after2 = logText(p);
  expect(after2.startsWith(after1)).toBe(true);
  expect(after2.slice(after1.length).split("\n").filter(Boolean).length).toBe(1);
  const s2 = (await w("show", "x")).stdout;
  for (const t of ["Use a log", "The body text", "The why text"]) expect(s2).toContain(t);
  expect(s2).not.toContain("proposed");
});

test("62.2 accept without claim refuses", async () => {
  await w("add", "x", "--title", "Use a log");
  const n = lineCount();
  const r = await w("accept", "x");
  expect(r.code).not.toBe(0);
  expect(lineCount()).toBe(n);
  expect((await w("show", "x")).stdout).toContain("proposed");
  expect((await w("accept", "x", "--actor", "you")).code).toBe(0);
  expect((await w("show", "x")).stdout).not.toContain("proposed");
});

test("62.3 ghost words frozen", async () => {
  await w("add", "x", "--title", "Use a log", "--body", "b1");
  const n = lineCount();
  const a = await w("propose", "x", "--ops", '[{"tag":"new","new":"other body"}]');
  expect(a.code).not.toBe(0);
  expect(lineCount()).toBe(n);
  const b = await w("propose", "x", "--title", "Use an append-only log");
  expect(b.code).not.toBe(0);
  expect(lineCount()).toBe(n);
  const c = await w("add", "x", "--title", "A different title");
  expect(c.code).not.toBe(0);
  expect(lineCount()).toBe(n);
  const s = (await w("show", "x")).stdout;
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4 retitle of a real card shows only the new title", async () => {
  await w("add", "x", "--title", "Use a log", "--body", "b1");
  await w("accept", "x", "--actor", "you");
  const n = lineCount();
  const r = await w("propose", "x", "--title", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(lineCount()).toBe(n + 1);
  const s = (await w("show", "x")).stdout;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(logText(p)).toContain("Use a log");
  const n2 = lineCount();
  const b = await w("propose", "x", "--ops", '[{"tag":"elaborated","old":"b1","new":"b2 new body"}]');
  expect(b.code).toBe(0);
  expect(lineCount()).toBe(n2 + 1);
  const s2 = (await w("show", "x")).stdout;
  expect(s2).toContain("b2 new body");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 option, source, excerpt enter as ghosts", async () => {
  writeLog(p, openCard("x", "Real card"));
  chat("talk", spoken("we want magic links for login"));
  let n = lineCount();
  const step = (r: { stdout: string; code: number }) => {
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("proposed");
    expect(lineCount()).toBe(n + 1);
    n += 1;
  };
  step(await w("add", "opt", "--kind", "option", "--title", "Use cookies", "--why", "cookies break on mobile"));
  expect((await w("link", "opt", "x", "--type", "alternative_to")).code).toBe(0);
  n += 1;
  step(await w("add", "src", "--kind", "source", "--title", "RFC 6749", "--why", "tokens expire"));
  step(await w("quote", "x", "talk", "magic links for login"));
  expect((await w("show", "opt")).stdout).toContain("proposed");
  expect((await w("show", "src")).stdout).toContain("proposed");
  expect((await w("show", "x:ex0")).stdout).toContain("proposed");
  expect((await w("accept", "opt", "--actor", "you")).code).toBe(0);
  const o = (await w("show", "opt")).stdout;
  expect(o).not.toContain("proposed");
  expect(o).toContain("cookies break on mobile");
  expect((await w("show", "src")).stdout).toContain("proposed");
  expect((await w("show", "x:ex0")).stdout).toContain("proposed");
});
