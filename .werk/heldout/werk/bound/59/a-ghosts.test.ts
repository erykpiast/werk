// Held-out tests for steps 04.*, 62.*, 63.*, 64.*: ghosts, accept, frozen words, contract check.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) => readFileSync(logOf(p), "utf8").split("\n").filter(Boolean);
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));
function seed(p: Project, payload: Record<string, unknown>, type = "node.added") {
  appendFileSync(
    logOf(p),
    `${JSON.stringify({ seq: lines(p).length + 1, at: "t", actor: "you", type, payload: { kind: "card", ...payload } })}\n`,
  );
}
const header = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => /\bproposed\b/.test(header(out));

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

// ---------- 04 ----------

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  seed(p, { id: "checkout", title: "Checkout flow", parent: "root" });
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "root"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const fresh = events(p).slice(before);
  expect(fresh).toHaveLength(1);
  expect(fresh[0].type).toBe("node.proposed");
  expect(fresh[0].payload.parent).toBe("checkout");
  const shown = await ok(p, ["show", "retry"]);
  expect(isGhost(shown.out)).toBe(true);
  expect(shown.out).toContain("parent: checkout  Checkout flow");

  const mid = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const acc = events(p).slice(mid);
  expect(acc).toHaveLength(1);
  expect(acc[0].type).toBe("change.accepted");
  const real = await ok(p, ["show", "retry"]);
  expect(isGhost(real.out)).toBe(false);
  expect(real.out).toContain("parent: checkout  Checkout flow");
  expect(isGhost((await ok(p, ["show", "other"])).out)).toBe(true);
});

test("04.2 accepting a ghost child also accepts its ghost parent, and its held link goes live", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  seed(p, { id: "payments", title: "Payments", parent: "root" });
  seed(p, { id: "fraud", title: "Fraud rules", parent: "root" });
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "uses the fraud rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "No partial", "--why_not", "users want it"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Refund study", "--finding", "half want partial"]);
  await ok(p, ["link", "partial", "bench", "--type", "supported_by"]);
  const held = await ok(p, ["show", "partial"]);
  expect(held.out).toMatch(/-> depends_on\s+fraud {2}Fraud rules {2}\(held\)/);

  const before = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const fresh = events(p).slice(before);
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((e) => e.type === "change.accepted")).toBe(true);
  expect(isGhost((await ok(p, ["show", "refunds"])).out)).toBe(false);
  const live = await ok(p, ["show", "partial"]);
  expect(isGhost(live.out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "partial:opt0"])).out)).toBe(false);
  expect(isGhost((await ok(p, ["show", "bench"])).out)).toBe(false);
  const dep = live.out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud"));
  expect(dep).toBeDefined();
  expect(dep).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  seed(p, { id: "onboarding", title: "Onboarding", parent: "root" });
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const run = await p.werk(["show", id]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/no node #\S+ in the map/);
  }
  const on = await ok(p, ["show", "onboarding"]);
  expect(on.out).not.toMatch(/<- refines.*ghost/);
  expect(on.out).not.toContain("email");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  seed(p, { id: "search", title: "Search", parent: "root" });
  await ok(p, ["add", "search-index", "--title", "Search index", "--why", "Fast lookup", "--parent", "search"]);
  const before = lines(p);
  const again = await p.werk([
    "add",
    "search-index",
    "--title",
    "Other words",
    "--why",
    "Other why",
    "--parent",
    "search",
  ]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const shown = await ok(p, ["show", "search-index"]);
  expect(shown.out).toContain("Search index");
  expect(shown.out).toContain("why: Fast lookup");
});

test("04.5 an accept from the command line needs --actor you", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const before = lines(p);
  const no = await p.werk(["accept", "audit"]);
  expect(no.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhost((await ok(p, ["show", "audit"])).out)).toBe(true);
  const yes = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect(isGhost((await ok(p, ["show", "audit"])).out)).toBe(false);
});

// ---------- 62 ----------

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  seed(p, { id: "root", title: "Root" });
  seed(p, { id: "other", title: "Other", parent: "root" });
  const before = lines(p);
  const add = await ok(p, ["add", "log", "--title", "Use a log", "--body", "One file per map.", "--why", "Replayable"]);
  expect(add.out).toContain("proposed");
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const ghost = await ok(p, ["show", "log"]);
  for (const s of ["Use a log", "One file per map.", "why: Replayable"]) expect(ghost.out).toContain(s);
  expect(isGhost(ghost.out)).toBe(true);
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const last = lines(p);
  expect(last).toHaveLength(after.length + 1);
  expect(last.slice(0, after.length)).toEqual(after);
  const real = await ok(p, ["show", "log"]);
  for (const s of ["Use a log", "One file per map.", "why: Replayable"]) expect(real.out).toContain(s);
  expect(isGhost(real.out)).toBe(false);
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const no = await p.werk(["accept", "log"]);
  expect(no.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(isGhost((await ok(p, ["show", "log"])).out)).toBe(true);
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(isGhost((await ok(p, ["show", "log"])).out)).toBe(false);
});

test("62.3 the words of a ghost are frozen (edit body, retitle, re-add)", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "first body"]);
  const before = lines(p);
  // Reading: edit body and retitle are `werk propose` (--ops / --title); no other verb changes words.
  const body = await p.werk([
    "propose",
    "log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "first body", new: "second body" }]),
  ]);
  expect(body.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const retitle = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const readd = await p.werk(["add", "log", "--title", "Another title"]);
  expect(readd.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const shown = await ok(p, ["show", "log"]);
  expect(shown.out).toContain("Use a log");
  expect(isGhost(shown.out)).toBe(true);
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "first body"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = lines(p);
  const retitle = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(retitle.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = await ok(p, ["show", "log"]);
  expect(shown.out).toContain("Use an append-only log");
  expect(shown.out).not.toContain("Use a log\n");
  expect(shown.out).not.toMatch(/Use a log(?!\w)/);
  expect(readFileSync(logOf(p), "utf8")).toContain('"title":"Use a log"');
  await ok(p, [
    "propose",
    "log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "first body", new: "second body" }]),
  ]);
  const again = await ok(p, ["show", "log"]);
  expect(again.out).toContain("second body");
  expect(again.out).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = freshProject();
  await ok(p, ["add", "store", "--title", "One log per conversation"]);
  await ok(p, ["accept", "store", "--actor", "you"]);
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "logs.jsonl"),
    `${JSON.stringify({ speaker: "agent", at: "10:02", session: "6ae61be7", kind: "spoken", text: "we keep one log per conversation" })}\n`,
  );
  const cmds = [
    ["add", "store:opt0", "--kind", "option", "--title", "One shared log", "--why_not", "Merges collide"],
    ["add", "paper", "--kind", "source", "--title", "Log paper", "--finding", "Append-only logs replay"],
    ["quote", "store", "logs", "one log per conversation"],
  ];
  for (const cmd of cmds) {
    const before = lines(p);
    const run = await ok(p, cmd);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  await ok(p, ["link", "store:opt0", "store", "--type", "alternative_to"]);
  const opt = await ok(p, ["show", "store:opt0"]);
  expect(opt.out).toContain("One shared log");
  expect(opt.out).toContain("why not: Merges collide");
  expect(isGhost(opt.out)).toBe(true);
  const src = await ok(p, ["show", "paper"]);
  expect(src.out).toContain("finding: Append-only logs replay");
  expect(isGhost(src.out)).toBe(true);
  const ex = await ok(p, ["show", "store:ex0"]);
  expect(ex.out).toContain("one log per conversation");
  expect(isGhost(ex.out)).toBe(true);
  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const optReal = await ok(p, ["show", "store:opt0"]);
  expect(isGhost(optReal.out)).toBe(false);
  expect(optReal.out).toContain("why not: Merges collide");
  expect(isGhost((await ok(p, ["show", "paper"])).out)).toBe(true);
  expect(isGhost((await ok(p, ["show", "store:ex0"])).out)).toBe(true);
});

// ---------- 63 ----------

test("63.1 a link to a ghost is held, and it goes live on accept with no extra link event", async () => {
  const p = freshProject();
  seed(p, { id: "storage", title: "Storage" });
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  // Reading: a depends_on link to the own parent is refused by a map rule, so "as its basis" is the
  // refines link to Storage (a decided parent counts as a basis).
  await ok(p, ["link", "sqlite", "storage", "--type", "refines"]);
  const held = await ok(p, ["show", "sqlite"]);
  const line = held.out.split("\n").find((l) => l.includes("-> refines") && l.includes("storage"));
  expect(line).toContain("held");
  const st = await ok(p, ["show", "storage"]);
  const back = st.out.split("\n").find((l) => l.includes("<- refines") && l.includes("sqlite"));
  expect(back).toContain("held");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const live = await ok(p, ["show", "sqlite"]);
  const l2 = live.out.split("\n").find((l) => l.includes("-> refines") && l.includes("storage"));
  expect(l2).toBeDefined();
  expect(l2).not.toContain("held");
  const linkEvents = events(p).filter(
    (e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents).toHaveLength(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = freshProject();
  seed(p, { id: "platform", title: "Platform" });
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the links"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  const magic = await ok(p, ["show", "magic"]);
  expect(isGhost(magic.out)).toBe(false);
  const auth = await ok(p, ["show", "auth"]);
  expect(isGhost(auth.out)).toBe(false);
  expect(auth.out).toContain("parent: platform  Platform");
  expect(isGhost((await ok(p, ["show", "email"])).out)).toBe(true);
  const dep = magic.out.split("\n").find((l) => l.includes("depends_on") && l.includes("email"));
  expect(dep).toContain("held");
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = freshProject();
  seed(p, { id: "storage", title: "Storage", status: "decided", who: "me" });
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "SQLite is fast enough"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  expect({ who: who.code, whoErr: who.err, status: status.code, statusErr: status.err }).toEqual({
    who: 0,
    whoErr: "",
    status: 0,
    statusErr: "",
  });
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const card = await ok(p, ["show", "sqlite"]);
  expect(header(card.out)).toContain("[decided]");
  expect(isGhost(card.out)).toBe(false);
  expect(card.out).toContain("who: you");
  const opt = await ok(p, ["show", "sqlite:opt0"]);
  expect(isGhost(opt.out)).toBe(false);
  expect(opt.out).toContain("why not: Needs a server");
  const src = await ok(p, ["show", "bench"]);
  expect(isGhost(src.out)).toBe(false);
  const link = src.out.split("\n").find((l) => l.includes("supported_by") && l.includes("sqlite"));
  expect(link).toBeDefined();
  expect(link).not.toContain("held");
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  seed(p, { id: "platform", title: "Platform" });
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "Phishing"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const pl = await ok(p, ["show", "platform"]);
  expect(isGhost(pl.out)).toBe(false);
  expect(pl.out).not.toContain("<- refines");
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  seed(p, { id: "storage", title: "Storage", status: "decided", who: "me" });
  seed(p, { id: "files", title: "Files", parent: "storage", status: "decided", who: "you", unchallenged: "obvious" });
  const sub = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:"));
  const s0 = await ok(p, ["show", "storage"]);
  const before = sub(s0.out);
  expect(before).toContain("unchallenged");
  expect(header(s0.out)).not.toContain("stale");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "me"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Postgres", "--why_not", "server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const s1 = await ok(p, ["show", "storage"]);
  expect(sub(s1.out)).toBe(before);
  expect(header(s1.out)).not.toContain("stale");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s2 = await ok(p, ["show", "storage"]);
  expect(sub(s2.out)).toContain("3 cards");
});

// ---------- 64 ----------
// Cards here have no parent, so a depends_on link is the only basis a card can have.

async function decidedBase(p: Project) {
  seed(p, { id: "base", title: "Base", status: "decided", who: "me" });
}

/** Runs one printed fix line ("werk ..."), with placeholders filled in. */
async function runFix(p: Project, line: string) {
  const filled = line
    .trim()
    .replace(/^or: /, "")
    .replace(/^then: /, "")
    .replace("you|me|prototype", "you")
    .replace(/<card>/g, "base")
    .replace(/<[^>]+>/g, "filled");
  const args = (filled.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ""));
  expect(args[0]).toBe("werk");
  return ok(p, args.slice(1));
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = freshProject();
  await decidedBase(p);
  seed(p, { id: "c", title: "Card", who: "you" });
  await ok(p, ["link", "c", "base", "--type", "depends_on", "--why", "uses base"]);
  seed(p, { id: "c:opt0", kind: "option", title: "Other", why_not: "worse" });
  await ok(p, ["link", "c:opt0", "c", "--type", "alternative_to"]);
  const before = lines(p);
  const run = await p.werk(["status", "c", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("kill criterion");
  const fix = text.split("\n").find((l) => l.trim().startsWith("werk kill c"));
  expect(fix).toBeDefined();
  expect(header((await ok(p, ["show", "c"])).out)).toContain("[open]");
  expect(lines(p)).toEqual(before);
  await runFix(p, fix as string);
  const again = await p.werk(["status", "c", "decided"]);
  expect(again.code).toBe(0);
  expect(header((await ok(p, ["show", "c"])).out)).toContain("[decided]");
});

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  const p = freshProject();
  await decidedBase(p);
  seed(p, { id: "c", title: "Card", body: "Some body." });
  const run = await p.werk(["status", "c", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(text).toContain(`  ${fact}`);
  expect(header((await ok(p, ["show", "c"])).out)).toContain("[open]");
  // Each fact's first printed command (and its "then:" line), in turn.
  const out = text.split("\n");
  const fixes: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (/^ {2}\S/.test(out[i] as string)) {
      fixes.push(out[i + 1] as string);
      if ((out[i + 2] ?? "").trim().startsWith("then:")) fixes.push(out[i + 2] as string);
    }
  }
  expect(fixes.length).toBeGreaterThanOrEqual(4);
  for (const fix of fixes) await runFix(p, fix);
  await ok(p, ["status", "c", "decided"]);
  expect(header((await ok(p, ["show", "c"])).out)).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = freshProject();
  await decidedBase(p);
  await ok(p, ["add", "g1", "--title", "Ghost one", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "uses base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Alt", "--why_not", "worse"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "Ghost two", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Alt", "--why_not", "worse"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const one = await p.werk(["status", "g1", "decided"]);
  expect(one.code).toBe(0);
  expect(header((await ok(p, ["show", "g1"])).out)).toContain("[decided]");
  const two = await p.werk(["status", "g2", "decided"]);
  expect(two.code).not.toBe(0);
  const text = two.out + two.err;
  expect(text).toContain("basis:");
  expect(text).toContain("werk link g2 <card> --type depends_on");
  expect(header((await ok(p, ["show", "g2"])).out)).not.toContain("[decided]");
});

async function decidedFull(p: Project) {
  await decidedBase(p);
  seed(p, { id: "c", title: "Card", body: "A long body about the card.", who: "you" });
  await ok(p, ["link", "c", "base", "--type", "depends_on", "--why", "uses base"]);
  seed(p, { id: "c:opt0", kind: "option", title: "Other", why_not: "worse" });
  await ok(p, ["link", "c:opt0", "c", "--type", "alternative_to"]);
  await ok(p, ["kill", "c", "--revisit"]);
  await ok(p, ["status", "c", "decided"]);
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = freshProject();
  await decidedFull(p);
  const before = (await ok(p, ["show", "c"])).out;
  // Reading: removing the depends_on edge of a decided card is the unlink of that edge.
  const run = await p.werk(["unlink", "c", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("basis:");
  expect(text).toContain("werk link c <card> --type depends_on");
  const after = (await ok(p, ["show", "c"])).out;
  expect(header(after)).toContain("[decided]");
  expect(after).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = freshProject();
  await decidedFull(p);
  const before = lines(p).length;
  // Reading: an amend is a staged body change (propose --ops) that the person accepts.
  await ok(p, [
    "propose",
    "c",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "A long body about the card.", new: "Short." }]),
  ]);
  const acc = await p.werk(["accept", "c", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const shown = (await ok(p, ["show", "c"])).out;
  expect(header(shown)).toContain("[decided]");
  expect(shown).toContain("Short.");
  const fresh = events(p).slice(before);
  const kinds = fresh.map((e) => e.type);
  // The log must show the amend as a reopen and a decide of the card.
  expect(kinds.some((k) => k === "node.reopened") && kinds.some((k) => k === "node.decided")).toBe(true);
});
