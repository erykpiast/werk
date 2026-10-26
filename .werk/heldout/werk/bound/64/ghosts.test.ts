// Held-out steps 04.x, 62.x and 63.x: ghosts, accept and discard on the command line.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type P, proj } from "./h.ts";

/** The first line of a show: kind, id, status, mark, and "proposed" for a ghost. */
const head = (out: string) => out.split("\n")[0] ?? "";
const isGhost = (out: string) => / {2}proposed( |$)/.test(head(out));
const subtree = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:"));

/** A real card made through the command line: add, then accept with the person's claim. */
async function real(p: P, id: string, title: string, parent?: string) {
  await p.ok("add", id, "--title", title, ...(parent ? ["--parent", parent] : []));
  await p.ok("accept", id, "--actor", "you");
}

/** A real decided card with every contract fact, seeded into the log. */
function decidedSeed(p: P, id: string, title: string, parent?: string, extra: object = {}) {
  p.seed("node.added", {
    id,
    kind: "card",
    title,
    status: "decided",
    who: "you",
    no_basis: "the top",
    ...(parent ? { parent } : {}),
    ...extra,
  });
  p.seed("kill.added", { id, criterion: { form: "revisit" } });
}

test("04.1", async () => {
  const p = proj();
  await real(p, "checkout", "Checkout flow");
  await p.ok("add", "other-ghost", "--title", "Another ghost");
  const before = p.events().length;
  const out = await p.ok("add", "retry-payment", "--title", "Retry payment", "--parent", "checkout");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const events = p.events();
  expect(events.length).toBe(before + 1);
  const ev = events.at(-1);
  expect(ev?.type).toBe("node.proposed");
  expect(ev?.payload.parent).toBe("checkout");
  const show = await p.ok("show", "retry-payment");
  expect(isGhost(show)).toBe(true);
  expect(show).toContain("parent: checkout  Checkout flow");
  await p.ok("accept", "retry-payment", "--actor", "you");
  const after = p.events();
  expect(after.length).toBe(before + 2);
  expect(after.at(-1)?.type).toBe("change.accepted");
  const shown = await p.ok("show", "retry-payment");
  expect(isGhost(shown)).toBe(false);
  expect(shown).toContain("parent: checkout  Checkout flow");
  expect(isGhost(await p.ok("show", "other-ghost"))).toBe(true);
});

test("04.2", async () => {
  const p = proj();
  await real(p, "payments", "Payments");
  await real(p, "fraud-rules", "Fraud rules");
  await p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  await p.ok("add", "partial-refunds", "--title", "Partial refunds", "--parent", "refunds");
  await p.ok("link", "partial-refunds", "fraud-rules", "--type", "depends_on", "--why", "uses the fraud rules");
  await p.ok(
    "add",
    "partial-refunds:opt0",
    "--kind",
    "option",
    "--title",
    "Full refunds only",
    "--why_not",
    "too coarse",
  );
  await p.ok("link", "partial-refunds:opt0", "partial-refunds", "--type", "alternative_to");
  await p.ok(
    "add",
    "refund-study",
    "--kind",
    "source",
    "--title",
    "Refund study",
    "--finding",
    "most refunds are partial",
  );
  await p.ok("link", "partial-refunds", "refund-study", "--type", "supported_by");
  const held = await p.ok("show", "partial-refunds");
  expect(held).toMatch(/-> depends_on\s+fraud-rules\s+Fraud rules\s+\(held\)/);
  const before = p.events().length;
  await p.ok("accept", "partial-refunds", "--actor", "you");
  const added = p.events().slice(before);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((e) => e.type === "change.accepted")).toBe(true);
  expect(isGhost(await p.ok("show", "refunds"))).toBe(false);
  const live = await p.ok("show", "partial-refunds");
  expect(isGhost(live)).toBe(false);
  expect(isGhost(await p.ok("show", "partial-refunds:opt0"))).toBe(false);
  expect(isGhost(await p.ok("show", "refund-study"))).toBe(false);
  const dep = live.split("\n").find((l) => l.includes("-> depends_on"));
  expect(dep).toContain("fraud-rules");
  expect(dep).not.toContain("held");
});

test("04.3", async () => {
  const p = proj();
  await real(p, "onboarding", "Onboarding");
  await p.ok("add", "email-verification", "--title", "Email verification", "--parent", "onboarding");
  await p.ok("add", "resend-email", "--title", "Resend email", "--parent", "email-verification");
  await p.ok("discard", "email-verification");
  for (const id of ["email-verification", "resend-email"]) {
    const r = await p.w("show", id);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/no node #\S+ in the map/);
  }
  const show = await p.ok("show", "onboarding");
  expect(show).not.toContain("ghost");
  expect(show).not.toContain("<- refines");
});

test("04.4", async () => {
  const p = proj();
  await real(p, "search", "Search");
  await p.ok("add", "search-index", "--title", "Search index", "--why", "Lookups must be fast", "--parent", "search");
  const before = p.log();
  const r = await p.w(
    "add",
    "search-index",
    "--title",
    "Index of search",
    "--why",
    "Other words",
    "--parent",
    "search",
  );
  expect(r.code).not.toBe(0);
  expect(r.err + r.out).toMatch(/ghost's words are frozen/);
  expect(p.log()).toEqual(before);
  const show = await p.ok("show", "search-index");
  expect(show).toContain("Search index");
  expect(show).toContain("why: Lookups must be fast");
});

test("04.5", async () => {
  const p = proj();
  await real(p, "compliance", "Compliance");
  await p.ok("add", "audit-log", "--title", "Audit log", "--parent", "compliance");
  const before = p.log();
  const r = await p.w("accept", "audit-log");
  expect(r.code).not.toBe(0);
  expect(p.log()).toEqual(before);
  expect(isGhost(await p.ok("show", "audit-log"))).toBe(true);
  const r2 = await p.w("accept", "audit-log", "--actor", "you");
  expect(r2.code).toBe(0);
  expect(isGhost(await p.ok("show", "audit-log"))).toBe(false);
});

test("62.1", async () => {
  const p = proj();
  await real(p, "root", "Root");
  await real(p, "other", "Other", "root");
  const before = p.log();
  expect(before.length).toBeGreaterThan(0);
  const out = await p.ok(
    "add",
    "use-log",
    "--title",
    "Use a log",
    "--body",
    "Every write appends.",
    "--why",
    "History stays.",
  );
  expect(out).toContain("proposed");
  const mid = p.log();
  expect(mid.length).toBe(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const shown = await p.ok("show", "use-log");
  for (const s of ["Use a log", "Every write appends.", "History stays."]) expect(shown).toContain(s);
  expect(isGhost(shown)).toBe(true);
  await p.ok("accept", "use-log", "--actor", "you");
  const after = p.log();
  expect(after.length).toBe(mid.length + 1);
  expect(after.slice(0, mid.length)).toEqual(mid);
  const real2 = await p.ok("show", "use-log");
  for (const s of ["Use a log", "Every write appends.", "History stays."]) expect(real2).toContain(s);
  expect(isGhost(real2)).toBe(false);
});

test("62.2", async () => {
  const p = proj();
  await p.ok("add", "use-log", "--title", "Use a log");
  const before = p.log();
  const r = await p.w("accept", "use-log");
  expect(r.code).not.toBe(0);
  expect(p.log()).toEqual(before);
  expect(isGhost(await p.ok("show", "use-log"))).toBe(true);
  await p.ok("accept", "use-log", "--actor", "you");
  expect(isGhost(await p.ok("show", "use-log"))).toBe(false);
});

test("62.3", async () => {
  const p = proj();
  await p.ok("add", "use-log", "--title", "Use a log");
  let before = p.log();
  const body = await p.w("propose", "use-log", "--ops", JSON.stringify([{ tag: "new", new: "A new body." }]));
  expect(body.code).not.toBe(0);
  expect(p.log()).toEqual(before);
  before = p.log();
  const retitle = await p.w("propose", "use-log", "--title", "Use an append-only log");
  expect(retitle.code).not.toBe(0);
  expect(p.log()).toEqual(before);
  const again = await p.w("add", "use-log", "--title", "Something else");
  expect(again.code).not.toBe(0);
  expect(p.log()).toEqual(before);
  const show = await p.ok("show", "use-log");
  expect(show).toContain("Use a log");
  expect(isGhost(show)).toBe(true);
});

test("62.4", async () => {
  const p = proj();
  await p.ok("add", "use-log", "--title", "Use a log");
  await p.ok("accept", "use-log", "--actor", "you");
  const before = p.log();
  const r = await p.w("propose", "use-log", "--title", "Use an append-only log");
  expect(r.code).toBe(0);
  const after = p.log();
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const show = await p.ok("show", "use-log");
  expect(p.log().some((l) => l.includes('"Use a log"'))).toBe(true);
  expect(show).toContain("Use an append-only log");
  expect(show).not.toContain("Use a log");
  await p.ok("propose", "use-log", "--ops", JSON.stringify([{ tag: "new", new: "Every write appends." }]));
  const show2 = await p.ok("show", "use-log");
  expect(show2).toContain("Every write appends.");
  expect(show2).toContain("Use an append-only log");
});

test("62.5", async () => {
  const p = proj();
  await real(p, "storage", "Storage");
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "a log keeps every write" })}\n`,
  );
  const steps: string[][] = [
    ["add", "storage:opt0", "--kind", "option", "--title", "Use files", "--why_not", "no history"],
    ["add", "bench", "--kind", "source", "--title", "Benchmark", "--finding", "logs are fast"],
    ["quote", "storage", "talk", "a log keeps every write"],
  ];
  for (const args of steps) {
    const before = p.log();
    const out = await p.ok(...args);
    expect(out).toContain("proposed");
    const after = p.log();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  await p.ok("link", "storage:opt0", "storage", "--type", "alternative_to");
  const excerpt = (p.events().find((e) => e.type === "excerpt.quoted")?.payload.id ?? "") as string;
  const opt = await p.ok("show", "storage:opt0");
  expect(isGhost(opt)).toBe(true);
  expect(opt).toContain("why not: no history");
  const src = await p.ok("show", "bench");
  expect(isGhost(src)).toBe(true);
  expect(src).toContain("finding: logs are fast");
  const ex = await p.ok("show", excerpt);
  expect(isGhost(ex)).toBe(true);
  expect(ex).toContain("a log keeps every write");
  await p.ok("accept", "storage:opt0", "--actor", "you");
  const opt2 = await p.ok("show", "storage:opt0");
  expect(isGhost(opt2)).toBe(false);
  expect(opt2).toContain("why not: no history");
  expect(isGhost(await p.ok("show", "bench"))).toBe(true);
  expect(isGhost(await p.ok("show", excerpt))).toBe(true);
});

test("63.1", async () => {
  const p = proj();
  await real(p, "storage", "Storage");
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  const link = await p.w("link", "use-sqlite", "storage", "--type", "depends_on", "--why", "the store it implements");
  expect(link.code).toBe(0);
  const show = await p.ok("show", "use-sqlite");
  expect(show).toMatch(/-> depends_on\s+storage .*\(held\)/);
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const live = await p.ok("show", "use-sqlite");
  expect(live).toMatch(/-> depends_on\s+storage\s+Storage\s*$/m);
  expect(p.events().filter((e) => e.type === "edge.added" && e.payload.type === "depends_on").length).toBe(1);
});

test("63.2", async () => {
  const p = proj();
  await real(p, "platform", "Platform");
  await p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await p.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await p.ok("add", "email-service", "--title", "Email service", "--parent", "platform");
  await p.ok("link", "magic-links", "email-service", "--type", "depends_on", "--why", "sends the link");
  await p.ok("accept", "magic-links", "--actor", "you");
  expect(isGhost(await p.ok("show", "magic-links"))).toBe(false);
  const auth = await p.ok("show", "auth");
  expect(isGhost(auth)).toBe(false);
  expect(auth).toContain("parent: platform  Platform");
  expect(isGhost(await p.ok("show", "email-service"))).toBe(true);
  const dep = (await p.ok("show", "magic-links")).split("\n").find((l) => l.includes("-> depends_on"));
  expect(dep).toContain("email-service");
  expect(dep).toContain("held");
});

test("63.3", async () => {
  const p = proj();
  decidedSeed(p, "storage", "Storage");
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.ok("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await p.ok("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await p.ok("add", "benchmark-notes", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough");
  await p.ok("link", "use-sqlite", "benchmark-notes", "--type", "supported_by");
  const refusals: string[] = [];
  for (const args of [
    ["edit", "use-sqlite", "--who", "me"],
    ["edit", "use-sqlite", "--no-basis", "the parent is the only basis"],
    ["kill", "use-sqlite", "--revisit"],
    ["status", "use-sqlite", "decided"],
  ]) {
    const r = await p.w(...args);
    if (r.code !== 0) refusals.push(`${args.join(" ")}: ${r.err}`);
  }
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const card = await p.ok("show", "use-sqlite");
  expect(isGhost(card)).toBe(false);
  expect(head(card)).toContain("[decided]");
  expect(card).toContain("who: me");
  const opt = await p.ok("show", "use-sqlite:opt0");
  expect(isGhost(opt)).toBe(false);
  expect(opt).toContain("why not: needs a server");
  const src = await p.ok("show", "benchmark-notes");
  expect(isGhost(src)).toBe(false);
  expect(src).toMatch(/<- supported_by\s+use-sqlite\s+Use SQLite\s*$/m);
  expect(refusals).toEqual([]);
});

test("63.4", async () => {
  const p = proj();
  await real(p, "platform", "Platform");
  await p.ok("add", "auth", "--title", "Auth", "--parent", "platform");
  await p.ok("add", "magic-links", "--title", "Magic links", "--parent", "auth");
  await p.ok("add", "magic-links:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "phishable");
  await p.ok("link", "magic-links:opt0", "magic-links", "--type", "alternative_to");
  await p.ok("discard", "auth");
  for (const id of ["auth", "magic-links", "magic-links:opt0"]) expect((await p.w("show", id)).code).not.toBe(0);
  const plat = await p.ok("show", "platform");
  expect(isGhost(plat)).toBe(false);
  for (const s of ["Auth", "Magic links", "Passwords", "ghost"]) expect(plat).not.toContain(s);
});

test("63.5", async () => {
  const p = proj();
  decidedSeed(p, "storage", "Storage", undefined, { unchallenged: "nothing to weigh" });
  decidedSeed(p, "log-format", "Log format", "storage", { unchallenged: "one format only" });
  const first = await p.ok("show", "storage");
  const rollup = subtree(first);
  expect(rollup).toContain("unchallenged");
  const mark = head(first);
  expect(mark).not.toMatch(/stale/);
  await p.ok("add", "use-sqlite", "--title", "Use SQLite", "--parent", "storage");
  await p.ok("add", "use-sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server");
  await p.ok("link", "use-sqlite:opt0", "use-sqlite", "--type", "alternative_to");
  await p.ok("edit", "use-sqlite", "--who", "you");
  await p.ok("edit", "use-sqlite", "--no-basis", "the parent is the only basis");
  await p.ok("kill", "use-sqlite", "--revisit");
  await p.ok("status", "use-sqlite", "decided");
  const second = await p.ok("show", "storage");
  expect(subtree(second)).toBe(rollup);
  expect(head(second)).toBe(mark);
  await p.ok("accept", "use-sqlite", "--actor", "you");
  const third = await p.ok("show", "storage");
  expect(subtree(third)).toMatch(/^subtree: 3 cards/);
});
