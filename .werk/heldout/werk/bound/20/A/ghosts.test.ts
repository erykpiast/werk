// Held-out tests for steps 04.x, 62.x, 63.x: ghosts, accept, discard, frozen words, held links.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

function seed(p: Project, payload: Record<string, unknown>) {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload })}\n`);
}
const realCard = (p: Project, id: string, title: string, extra: Record<string, unknown> = {}) =>
  seed(p, { id, kind: "card", title, ...extra });

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
const show = async (p: Project, id: string) => (await p.werk(["show", id])).out;
const header = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => /\bproposed\b/.test(header(out));

// ---------- 04.x ----------

test("04.1", async () => {
  const p = freshProject();
  realCard(p, "checkout", "Checkout flow");
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "checkout"]);
  const before = lines(p).length;
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  const said = add.out + add.err;
  expect(said).toContain("proposed");
  expect(said).not.toContain("added");
  const after = events(p);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1).type).toBe("node.proposed");
  expect(after.at(-1).payload.parent).toBe("checkout");
  const s1 = await show(p, "retry");
  expect(isGhost(s1)).toBe(true);
  expect(s1).toMatch(/parent: checkout\s+Checkout flow/);

  const n = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const acc = events(p);
  expect(acc.length).toBe(n + 1);
  expect(acc.at(-1).type).toMatch(/accept/);
  const s2 = await show(p, "retry");
  expect(isGhost(s2)).toBe(false);
  expect(s2).toMatch(/parent: checkout\s+Checkout flow/);
  expect(isGhost(await show(p, "other"))).toBe(true);
});

test("04.2", async () => {
  const p = freshProject();
  realCard(p, "payments", "Payments");
  realCard(p, "fraud", "Fraud rules");
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "partial refunds obey the fraud rules"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full refunds only", "--why_not", "too strict"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "ledger", "--kind", "source", "--title", "Ledger study", "--finding", "partials are common"]);
  await ok(p, ["link", "partial", "ledger", "--type", "supported_by"]);
  const before = await show(p, "partial");
  const depLine = (out: string) => out.split("\n").find((l) => l.includes("depends_on") && l.includes("fraud")) ?? "";
  expect(depLine(before)).toContain("held");

  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toMatch(/accept/);
  expect(isGhost(await show(p, "refunds"))).toBe(false);
  const after = await show(p, "partial");
  expect(isGhost(after)).toBe(false);
  expect(isGhost(await show(p, "partial:opt0"))).toBe(false);
  expect(isGhost(await show(p, "ledger"))).toBe(false);
  expect(depLine(after)).not.toBe("");
  expect(depLine(after)).not.toContain("held");
});

test("04.3", async () => {
  const p = freshProject();
  realCard(p, "onboarding", "Onboarding");
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  const a = await p.werk(["show", "email"]);
  const b = await p.werk(["show", "resend"]);
  expect(a.err + a.out).toMatch(/no node #email in the map/);
  expect(b.err + b.out).toMatch(/no node #resend in the map/);
  const o = await show(p, "onboarding");
  expect(o).not.toContain("ghost");
  expect(o).not.toContain("email");
});

test("04.4", async () => {
  const p = freshProject();
  realCard(p, "search", "Search");
  await ok(p, [
    "add",
    "search-index",
    "--title",
    "One index per tenant",
    "--why",
    "tenants never share",
    "--parent",
    "search",
  ]);
  const n = lines(p).length;
  const again = await p.werk(["add", "search-index", "--title", "A shared index", "--why", "cheaper"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toMatch(/frozen/);
  expect(lines(p).length).toBe(n);
  const s = await show(p, "search-index");
  expect(s).toContain("One index per tenant");
  expect(s).toContain("why: tenants never share");
});

test("04.5", async () => {
  const p = freshProject();
  realCard(p, "platform", "Platform");
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "platform"]);
  const n = lines(p).length;
  const no = await p.werk(["accept", "audit"]);
  expect(no.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(isGhost(await show(p, "audit"))).toBe(true);
  const yes = await p.werk(["accept", "audit", "--actor", "you"]);
  expect(yes.code).toBe(0);
  expect(isGhost(await show(p, "audit"))).toBe(false);
});

// ---------- 62.x ----------

test("62.1", async () => {
  const p = freshProject();
  realCard(p, "root", "Root");
  realCard(p, "other", "Other", { parent: "root" });
  const before = lines(p);
  const add = await ok(p, [
    "add",
    "log",
    "--title",
    "Use a log",
    "--body",
    "Every write appends.",
    "--why",
    "Replay is cheap.",
  ]);
  expect(add.out).toContain("proposed");
  const mid = lines(p);
  expect(mid.length).toBe(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const s1 = await show(p, "log");
  expect(s1).toContain("Use a log");
  expect(s1).toContain("Every write appends.");
  expect(s1).toContain("Replay is cheap.");
  expect(isGhost(s1)).toBe(true);
  const acc = await p.werk(["accept", "log", "--actor", "you"]);
  expect(acc.code).toBe(0);
  const end = lines(p);
  expect(end.length).toBe(mid.length + 1);
  expect(end.slice(0, mid.length)).toEqual(mid);
  const s2 = await show(p, "log");
  expect(s2).toContain("Use a log");
  expect(s2).toContain("Every write appends.");
  expect(s2).toContain("Replay is cheap.");
  expect(isGhost(s2)).toBe(false);
});

test("62.2", async () => {
  const p = freshProject();
  realCard(p, "root", "Root");
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const n = lines(p).length;
  const no = await p.werk(["accept", "log"]);
  expect(no.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  expect(isGhost(await show(p, "log"))).toBe(true);
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(isGhost(await show(p, "log"))).toBe(false);
});

test("62.3", async () => {
  const p = freshProject();
  realCard(p, "root", "Root");
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const n = lines(p).length;
  const edit = await p.werk(["edit", "log", "--body", "A new body"]);
  expect(edit.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const re = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(re.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const again = await p.werk(["add", "log", "--title", "Use a database"]);
  expect(again.code).not.toBe(0);
  expect(lines(p).length).toBe(n);
  const s = await show(p, "log");
  expect(s.split("\n")[1]).toBe("Use a log");
  expect(isGhost(s)).toBe(true);
});

test("62.4", async () => {
  const p = freshProject();
  realCard(p, "root", "Root");
  await ok(p, ["add", "log", "--title", "Use a log"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const n = lines(p);
  const re = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(re.code).toBe(0);
  const after = lines(p);
  expect(after.length).toBe(n.length + 1);
  expect(after.slice(0, n.length)).toEqual(n);
  const s = await show(p, "log");
  expect(s).toContain("Use an append-only log");
  expect(s).not.toMatch(/Use a log/);
  expect(readFileSync(logOf(p), "utf8")).toContain('"Use a log"');
  await ok(p, ["edit", "log", "--body", "Every write appends one line."]);
  const s2 = await show(p, "log");
  expect(s2).toContain("Every write appends one line.");
  expect(s2).toContain("Use an append-only log");
});

test("62.5", async () => {
  const p = freshProject();
  realCard(p, "root", "Root");
  realCard(p, "store", "Store", { parent: "root" });
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "design.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "we keep one log per store" })}\n`,
  );
  const step = async (args: string[]) => {
    const before = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  };
  await step(["add", "store:opt0", "--kind", "option", "--title", "Use a database", "--why_not", "needs a server"]);
  await ok(p, ["link", "store:opt0", "store", "--type", "alternative_to"]);
  await step(["add", "bench", "--kind", "source", "--title", "Bench notes", "--finding", "appends are fast"]);
  // An excerpt enters only through a quote; a plain add of kind excerpt is refused by design.
  await step(["quote", "store", "design", "one log per store"]);
  const opt = await show(p, "store:opt0");
  expect(opt).toContain("Use a database");
  expect(opt).toContain("needs a server");
  expect(isGhost(opt)).toBe(true);
  const src = await show(p, "bench");
  expect(src).toContain("Bench notes");
  expect(src).toContain("appends are fast");
  expect(isGhost(src)).toBe(true);
  const ex = await show(p, "store:ex0");
  expect(ex).toContain("one log per store");
  expect(isGhost(ex)).toBe(true);
  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const opt2 = await show(p, "store:opt0");
  expect(isGhost(opt2)).toBe(false);
  expect(opt2).toContain("needs a server");
  expect(isGhost(await show(p, "bench"))).toBe(true);
  expect(isGhost(await show(p, "store:ex0"))).toBe(true);
});

// ---------- 63.x ----------

test("63.1", async () => {
  const p = freshProject();
  realCard(p, "storage", "Storage");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  const link = await p.werk(["link", "sqlite", "storage", "--type", "depends_on", "--why", "Storage sets the need"]);
  expect(link.err).toBe("");
  expect(link.code).toBe(0);
  const edge = (out: string) => out.split("\n").find((l) => l.includes("depends_on") && l.includes("storage")) ?? "";
  expect(edge(await show(p, "sqlite"))).toContain("held");
  const st = await show(p, "storage");
  expect(st.split("\n").some((l) => l.includes("depends_on") && l.includes("sqlite") && !l.includes("held"))).toBe(
    false,
  );
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const e = edge(await show(p, "sqlite"));
  expect(e).not.toBe("");
  expect(e).not.toContain("held");
  const linkEvents = events(p).filter(
    (ev) => /link/.test(ev.type) && ev.payload.from === "sqlite" && ev.payload.to === "storage",
  );
  expect(linkEvents.length).toBe(1);
});

test("63.2", async () => {
  const p = freshProject();
  realCard(p, "platform", "Platform");
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "magic links need email"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  const m = await show(p, "magic");
  expect(isGhost(m)).toBe(false);
  const a = await show(p, "auth");
  expect(isGhost(a)).toBe(false);
  expect(a).toMatch(/parent: platform\s+Platform/);
  expect(isGhost(await show(p, "email"))).toBe(true);
  const edge = m.split("\n").find((l) => l.includes("depends_on") && l.includes("email")) ?? "";
  expect(edge).toContain("held");
});

test("63.3", async () => {
  const p = freshProject();
  realCard(p, "storage", "Storage", { status: "decided", who: "me" });
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  // The contract check of a decide also needs a basis and a kill criterion; the binder supplies them.
  await ok(p, ["edit", "sqlite", "--no-basis", "no decided card is a basis yet"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  const who = await p.werk(["edit", "sqlite", "--who", "you"]);
  const status = await p.werk(["status", "sqlite", "decided"]);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = await show(p, "sqlite");
  expect(isGhost(s)).toBe(false);
  expect(header(s)).toContain("[decided]");
  expect(s).toMatch(/who: you|who\s+you|you/);
  const o = await show(p, "sqlite:opt0");
  expect(isGhost(o)).toBe(false);
  expect(o).toContain("needs a server");
  const b = await show(p, "bench");
  expect(isGhost(b)).toBe(false);
  const edge = b.split("\n").find((l) => l.includes("supported_by") && l.includes("sqlite")) ?? "";
  expect(edge).not.toBe("");
  expect(edge).not.toContain("held");
  expect(who.code).toBe(0);
  expect(status.code).toBe(0);
});

test("63.4", async () => {
  const p = freshProject();
  realCard(p, "platform", "Platform");
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "users forget them"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/no node/);
  }
  const pl = await show(p, "platform");
  expect(isGhost(pl)).toBe(false);
  expect(pl).not.toContain("ghost");
  expect(pl).not.toContain("Auth");
});

test("63.5", async () => {
  const p = freshProject();
  realCard(p, "storage", "Storage", { status: "decided", who: "you", unchallenged: "nothing weighed" });
  realCard(p, "child", "Child", { parent: "storage", status: "decided", who: "you", unchallenged: "nothing weighed" });
  const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
  const s0 = await show(p, "storage");
  const r0 = subtree(s0);
  expect(r0).toContain("2 cards");
  expect(s0).not.toMatch(/stale/);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["edit", "sqlite", "--who", "you"]);
  await ok(p, ["edit", "sqlite", "--no-basis", "no decided card is a basis yet"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  const s1 = await show(p, "storage");
  expect(subtree(s1)).toBe(r0);
  expect(s1).not.toMatch(/stale/);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  expect(subtree(await show(p, "storage"))).toContain("3 cards");
});
