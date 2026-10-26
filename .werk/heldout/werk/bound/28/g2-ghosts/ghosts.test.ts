import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const raw = (p: Project) => readFileSync(logOf(p), "utf8");
const lines = (p: Project) =>
  raw(p)
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

let seq = 0;
function seed(p: Project, payload: Record<string, unknown>, type = "node.added") {
  const n = lines(p).length + 1;
  seq = n;
  appendFileSync(logOf(p), `${JSON.stringify({ seq: n, at: "t", actor: "you", type, payload })}\n`);
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
async function show(p: Project, id: string) {
  return ok(p, ["show", id]);
}
const head = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => /\sproposed\b/.test(head(out));
const lineWith = (out: string, needle: string) => out.split("\n").find((l) => l.includes(needle)) ?? "";
const subtree = (out: string) => lineWith(out, "subtree:");

// ---------- 04.x ----------

test("04.1", async () => {
  const p = freshProject();
  seed(p, { id: "checkout", kind: "card", title: "Checkout flow" });
  await ok(p, ["add", "other", "--title", "Other ghost", "--why", "w", "--parent", "checkout"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--why", "w", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const ev = events(p);
  expect(ev.length).toBe(before + 1);
  expect(ev.at(-1).type).toBe("node.proposed");
  expect(ev.at(-1).payload.parent).toBe("checkout");
  let s = await show(p, "retry");
  expect(isGhost(s.out)).toBe(true);
  expect(lineWith(s.out, "parent:")).toContain("checkout");
  const before2 = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  expect(lines(p).length).toBe(before2 + 1);
  expect(events(p).at(-1).type).toBe("change.accepted");
  s = await show(p, "retry");
  expect(isGhost(s.out)).toBe(false);
  expect(lineWith(s.out, "parent:")).toContain("checkout");
  expect(isGhost((await show(p, "other")).out)).toBe(true);
});

test("04.2", async () => {
  const p = freshProject();
  seed(p, { id: "payments", kind: "card", title: "Payments" });
  seed(p, { id: "fraud", kind: "card", title: "Fraud rules" });
  await ok(p, ["add", "refunds", "--title", "Refunds", "--why", "w", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--why", "w", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "takes the fraud limits"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "No partial", "--why_not", "too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "src", "--kind", "source", "--title", "Refund stats", "--url", "http://x", "--finding", "f"]);
  await ok(p, ["link", "partial", "src", "--type", "supported_by"]);
  let s = await show(p, "partial");
  expect(lineWith(s.out, "depends_on")).toContain("(held)");
  const before = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(before);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(isGhost((await show(p, "refunds")).out)).toBe(false);
  s = await show(p, "partial");
  expect(isGhost(s.out)).toBe(false);
  expect(isGhost((await show(p, "partial:opt0")).out)).toBe(false);
  expect(isGhost((await show(p, "src")).out)).toBe(false);
  const dep = lineWith(s.out, "depends_on");
  expect(dep).toContain("fraud");
  expect(dep).not.toContain("held");
});

test("04.3", async () => {
  const p = freshProject();
  seed(p, { id: "onboarding", kind: "card", title: "Onboarding" });
  await ok(p, ["add", "ev", "--title", "Email verification", "--why", "w", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--why", "w", "--parent", "ev"]);
  await ok(p, ["discard", "ev"]);
  for (const id of ["ev", "resend"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`no node #${id} in the map`);
  }
  const s = await show(p, "onboarding");
  expect(s.out).not.toContain("ghost");
  expect(s.out).not.toContain("<- refines");
});

test("04.4", async () => {
  const p = freshProject();
  seed(p, { id: "search", kind: "card", title: "Search" });
  await ok(p, ["add", "si", "--title", "Search index", "--why", "first why", "--parent", "search"]);
  const before = raw(p);
  const r = await p.werk(["add", "si", "--title", "Other title", "--why", "other why", "--parent", "search"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("frozen");
  expect(raw(p)).toBe(before);
  const s = await show(p, "si");
  expect(s.out).toContain("Search index");
  expect(s.out).toContain("why: first why");
});

test("04.5", async () => {
  const p = freshProject();
  seed(p, { id: "base", kind: "card", title: "Base" });
  await ok(p, ["add", "audit", "--title", "Audit log", "--why", "w", "--parent", "base"]);
  const before = raw(p);
  const r = await p.werk(["accept", "audit"]);
  expect(r.code).not.toBe(0);
  expect(raw(p)).toBe(before);
  expect(isGhost((await show(p, "audit")).out)).toBe(true);
  const r2 = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(r2.code).toBe(0);
  expect(isGhost((await show(p, "audit")).out)).toBe(false);
});

// ---------- 62.x ----------

test("62.1", async () => {
  const p = freshProject();
  seed(p, { id: "a", kind: "card", title: "A" });
  seed(p, { id: "b", kind: "card", title: "B", parent: "a" });
  let before = raw(p);
  const add = await ok(p, [
    "add",
    "c",
    "--title",
    "Card C",
    "--body",
    "Body of C",
    "--why",
    "Why of C",
    "--parent",
    "a",
  ]);
  expect(add.out).toContain("proposed");
  let now = raw(p);
  expect(now.startsWith(before)).toBe(true);
  expect(lines(p).length).toBe(before.split("\n").filter(Boolean).length + 1);
  let s = await show(p, "c");
  for (const t of ["Card C", "Body of C", "Why of C"]) expect(s.out).toContain(t);
  expect(isGhost(s.out)).toBe(true);
  before = now;
  const acc = await p.werk(["accept", "c", "--actor", "you"]);
  expect(acc.code).toBe(0);
  now = raw(p);
  expect(now.startsWith(before)).toBe(true);
  expect(lines(p).length).toBe(before.split("\n").filter(Boolean).length + 1);
  s = await show(p, "c");
  for (const t of ["Card C", "Body of C", "Why of C"]) expect(s.out).toContain(t);
  expect(isGhost(s.out)).toBe(false);
});

test("62.2", async () => {
  const p = freshProject();
  await ok(p, ["add", "c", "--title", "Card C", "--why", "w"]);
  const before = raw(p);
  const r = await p.werk(["accept", "c"]);
  expect(r.code).not.toBe(0);
  expect(raw(p)).toBe(before);
  expect(isGhost((await show(p, "c")).out)).toBe(true);
  await ok(p, ["accept", "c", "--actor", "you"]);
  expect(isGhost((await show(p, "c")).out)).toBe(false);
});

test("62.3", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--why", "w"]);
  const before = raw(p);
  let r = await p.werk(["edit", "log", "--body", "new body"]);
  expect(r.code).not.toBe(0);
  expect(raw(p)).toBe(before);
  r = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(r.code).not.toBe(0);
  expect(raw(p)).toBe(before);
  r = await p.werk(["add", "log", "--title", "Something else", "--why", "w"]);
  expect(r.code).not.toBe(0);
  expect(raw(p)).toBe(before);
  const s = await show(p, "log");
  expect(s.out).toContain("Use a log");
  expect(isGhost(s.out)).toBe(true);
});

test("62.4", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--why", "w"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = raw(p);
  const r = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(r.code).toBe(0);
  expect(raw(p).startsWith(before)).toBe(true);
  expect(lines(p).length).toBe(before.split("\n").filter(Boolean).length + 1);
  let s = await show(p, "log");
  expect(s.out).toContain("Use an append-only log");
  expect(s.out.replaceAll("Use an append-only log", "")).not.toContain("Use a log");
  expect(lines(p)[0]).toContain("Use a log");
  await ok(p, ["edit", "log", "--body", "The new body"]);
  s = await show(p, "log");
  expect(s.out).toContain("The new body");
  expect(s.out).toContain("Use an append-only log");
});

test("62.5", async () => {
  const p = freshProject();
  seed(p, { id: "x", kind: "card", title: "X" });
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "we bill per seat" })}\n`,
  );
  const step = async (args: string[]) => {
    const before = raw(p);
    const r = await ok(p, args);
    expect(r.out).toContain("proposed");
    expect(raw(p).startsWith(before)).toBe(true);
    expect(lines(p).length).toBe(before.split("\n").filter(Boolean).length + 1);
  };
  await step(["add", "x:opt0", "--kind", "option", "--title", "Per user", "--why_not", "users churn"]);
  await ok(p, ["link", "x:opt0", "x", "--type", "alternative_to"]);
  await step([
    "add",
    "src",
    "--kind",
    "source",
    "--title",
    "Pricing notes",
    "--url",
    "http://x",
    "--finding",
    "seats win",
  ]);
  // An excerpt has no plain add (add --kind refuses excerpt by design); it enters through quote.
  await step(["quote", "x", "talk", "bill per seat"]);
  const exId = events(p).at(-1).payload.id as string;
  let o = await show(p, "x:opt0");
  expect(o.out).toContain("Per user");
  expect(o.out).toContain("users churn");
  expect(isGhost(o.out)).toBe(true);
  const sr = await show(p, "src");
  for (const t of ["Pricing notes", "http://x", "seats win"]) expect(sr.out).toContain(t);
  expect(isGhost(sr.out)).toBe(true);
  const ex = await show(p, exId);
  expect(ex.out).toContain("bill per seat");
  expect(isGhost(ex.out)).toBe(true);
  await ok(p, ["accept", "x:opt0", "--actor", "you"]);
  o = await show(p, "x:opt0");
  expect(isGhost(o.out)).toBe(false);
  expect(o.out).toContain("why not: users churn");
  expect(isGhost((await show(p, "src")).out)).toBe(true);
  expect(isGhost((await show(p, exId)).out)).toBe(true);
});

// ---------- 63.x ----------

test("63.1", async () => {
  const p = freshProject();
  seed(p, { id: "storage", kind: "card", title: "Storage", status: "decided", who: "me" });
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--why", "w", "--parent", "storage"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "takes the storage need"]);
  let s = await show(p, "sqlite");
  expect(lineWith(s.out, "-> depends_on")).toContain("(held)");
  const st = await show(p, "storage");
  const live = st.out
    .split("\n")
    .filter((l) => l.includes("depends_on") && l.includes("sqlite") && !l.includes("held"));
  expect(live).toHaveLength(0);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  s = await show(p, "sqlite");
  const dep = lineWith(s.out, "-> depends_on");
  expect(dep).toContain("storage");
  expect(dep).not.toContain("held");
  const linkEvents = events(p).filter(
    (e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents).toHaveLength(1);
});

test("63.2", async () => {
  const p = freshProject();
  seed(p, { id: "platform", kind: "card", title: "Platform" });
  await ok(p, ["add", "auth", "--title", "Auth", "--why", "w", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--why", "w", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--why", "w", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the link"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  const m = await show(p, "magic");
  expect(isGhost(m.out)).toBe(false);
  const a = await show(p, "auth");
  expect(isGhost(a.out)).toBe(false);
  expect(lineWith(a.out, "parent:")).toContain("platform");
  expect(isGhost((await show(p, "email")).out)).toBe(true);
  expect(lineWith(m.out, "-> depends_on")).toContain("held");
});

test("63.3", async () => {
  const p = freshProject();
  seed(p, { id: "storage", kind: "card", title: "Storage", status: "decided", who: "me" });
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--why", "w", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "a server to run"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, [
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Benchmark notes",
    "--url",
    "http://b",
    "--finding",
    "fast enough",
  ]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  // Contract facts other than who that the decide needs (setup, not in the step text).
  await ok(p, ["edit", "sqlite", "--no-basis", "nothing decided precedes it"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  const st = await p.werk(["status", "sqlite", "decided"]);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = await show(p, "sqlite");
  expect(isGhost(s.out)).toBe(false);
  expect(head(s.out)).toContain("[decided]");
  expect(events(p).some((e) => e.type === "node.edited" && e.payload.id === "sqlite" && e.payload.who === "you")).toBe(
    true,
  );
  const o = await show(p, "sqlite:opt0");
  expect(isGhost(o.out)).toBe(false);
  expect(o.out).toContain("why not: a server to run");
  const b = await show(p, "bench");
  expect(isGhost(b.out)).toBe(false);
  const edge = lineWith(b.out, "supported_by");
  expect(edge).toContain("sqlite");
  expect(edge).not.toContain("held");
  expect(who.code).toBe(0);
  expect(st.code).toBe(0);
});

test("63.4", async () => {
  const p = freshProject();
  seed(p, { id: "platform", kind: "card", title: "Platform" });
  await ok(p, ["add", "auth", "--title", "Auth", "--why", "w", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--why", "w", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "leaks"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const s = await show(p, "platform");
  expect(isGhost(s.out)).toBe(false);
  for (const t of ["Auth", "Magic links", "Passwords", "ghost"]) expect(s.out).not.toContain(t);
});

test("63.5", async () => {
  const p = freshProject();
  seed(p, { id: "storage", kind: "card", title: "Storage", status: "decided", who: "me" });
  seed(p, {
    id: "files",
    kind: "card",
    title: "Use files",
    parent: "storage",
    status: "decided",
    who: "you",
    unchallenged: "only one candidate",
    no_basis: "none",
  });
  const s0 = await show(p, "storage");
  const before = subtree(s0.out);
  expect(before).toContain("1 unchallenged");
  expect(s0.out.toLowerCase()).not.toContain("stale");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--why", "w", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["edit", "sqlite", "--no-basis", "none"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const s1 = await show(p, "storage");
  expect(subtree(s1.out)).toBe(before);
  expect(s1.out.toLowerCase()).not.toContain("stale");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s2 = await show(p, "storage");
  expect(before).toContain("2 cards");
  expect(subtree(s2.out)).toContain("3 cards");
  expect(subtree(s2.out)).toContain("3 decided");
});
