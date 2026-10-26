// Held-out steps 04.x, 62.x and 63.x: ghosts, accept, discard and frozen words at the command line.
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

/** Appends real nodes to the log, as an accepted map holds them. */
function seed(p: Project, list: object[]) {
  const start = lines(p).length;
  appendFileSync(
    logOf(p),
    list.map((e, i) => `${JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}
const card = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const show = async (p: Project, id: string) => (await p.werk(["show", id])).out;
const head = (out: string) => out.split("\n")[0] as string;

test("04.1 an agent's new card waits as a ghost until the person accepts it", async () => {
  const p = freshProject();
  seed(p, [card("checkout", "Checkout flow")]);
  await ok(p, ["add", "other", "--title", "Other ghost", "--parent", "checkout"]);
  const before = lines(p);
  const add = await ok(p, ["add", "retry", "--title", "Retry payment", "--parent", "checkout"]);
  expect(add.out).toContain("proposed");
  expect(add.out).not.toContain("added");
  const after = events(p).slice(before.length);
  expect(after).toHaveLength(1);
  expect(after[0].type).toBe("node.proposed");
  expect(after[0].payload.parent).toBe("checkout");
  const s = await show(p, "retry");
  expect(head(s)).toContain("proposed");
  expect(s).toContain("parent: checkout  Checkout flow");
  const n = lines(p).length;
  await ok(p, ["accept", "retry", "--actor", "you"]);
  const acc = events(p).slice(n);
  expect(acc).toHaveLength(1);
  expect(acc[0].type).toBe("change.accepted");
  const s2 = await show(p, "retry");
  expect(head(s2)).not.toContain("proposed");
  expect(s2).toContain("parent: checkout  Checkout flow");
  expect(head(await show(p, "other"))).toContain("proposed");
});

test("04.2 accepting a ghost child accepts its ghost parent; the held link goes live with no event", async () => {
  const p = freshProject();
  seed(p, [card("payments", "Payments"), card("fraud", "Fraud rules")]);
  await ok(p, ["add", "refunds", "--title", "Refunds", "--parent", "payments"]);
  await ok(p, ["add", "partial", "--title", "Partial refunds", "--parent", "refunds"]);
  await ok(p, ["link", "partial", "fraud", "--type", "depends_on", "--why", "reuses the fraud score"]);
  await ok(p, ["add", "partial:opt0", "--kind", "option", "--title", "Full only", "--why_not", "too coarse"]);
  await ok(p, ["link", "partial:opt0", "partial", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Refund study", "--finding", "half are partial"]);
  await ok(p, ["link", "partial", "bench", "--type", "supported_by"]);
  const s = await show(p, "partial");
  expect(s).toMatch(/-> depends_on\s+fraud\s+Fraud rules\s+\(held\)/);
  const n = lines(p).length;
  await ok(p, ["accept", "partial", "--actor", "you"]);
  const added = events(p).slice(n);
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(e.type).toBe("change.accepted");
  expect(head(await show(p, "refunds"))).not.toContain("proposed");
  const s2 = await show(p, "partial");
  expect(head(s2)).not.toContain("proposed");
  expect(head(await show(p, "partial:opt0"))).not.toContain("proposed");
  expect(head(await show(p, "bench"))).not.toContain("proposed");
  expect(s2).toMatch(/-> depends_on\s+fraud\s+Fraud rules\n/);
  expect(s2).not.toContain("held");
});

test("04.3 discarding a ghost parent drops its ghost children", async () => {
  const p = freshProject();
  seed(p, [card("onboarding", "Onboarding")]);
  await ok(p, ["add", "email", "--title", "Email verification", "--parent", "onboarding"]);
  await ok(p, ["add", "resend", "--title", "Resend email", "--parent", "email"]);
  await ok(p, ["discard", "email"]);
  for (const id of ["email", "resend"]) {
    const r = await p.werk(["show", id]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no node");
  }
  const s = await show(p, "onboarding");
  expect(s).not.toContain("ghost");
  expect(s).not.toContain("<- refines");
});

test("04.4 the words of a ghost are frozen", async () => {
  const p = freshProject();
  seed(p, [card("search", "Search")]);
  await ok(p, ["add", "index", "--title", "Search index", "--why", "Fast lookups", "--parent", "search"]);
  const before = lines(p);
  const r = await p.werk(["add", "index", "--title", "Search engine", "--why", "Other", "--parent", "search"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("frozen");
  expect(lines(p)).toEqual(before);
  const s = await show(p, "index");
  expect(s).toContain("Search index");
  expect(s).toContain("why: Fast lookups");
});

test("04.5 an accept from the command line needs the person's statement", async () => {
  const p = freshProject();
  seed(p, [card("root", "Root")]);
  await ok(p, ["add", "audit", "--title", "Audit log", "--parent", "root"]);
  const before = lines(p);
  const r = await p.werk(["accept", "audit"]);
  expect(r.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(head(await show(p, "audit"))).toContain("proposed");
  await ok(p, ["accept", "audit", "--actor", "you"]);
  expect(head(await show(p, "audit"))).not.toContain("proposed");
});

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = freshProject();
  seed(p, [card("root", "Root"), card("other", "Other", { parent: "root" })]);
  const before = lines(p);
  const add = await ok(p, ["add", "log", "--title", "Use a log", "--body", "One file", "--why", "Replayable"]);
  expect(add.out).toContain("proposed");
  const mid = lines(p);
  expect(mid).toHaveLength(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const s = await show(p, "log");
  for (const t of ["Use a log", "One file", "Replayable"]) expect(s).toContain(t);
  expect(head(s)).toContain("proposed");
  await ok(p, ["accept", "log", "--actor", "you"]);
  const end = lines(p);
  expect(end).toHaveLength(mid.length + 1);
  expect(end.slice(0, mid.length)).toEqual(mid);
  const s2 = await show(p, "log");
  for (const t of ["Use a log", "One file", "Replayable"]) expect(s2).toContain(t);
  expect(head(s2)).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const r = await p.werk(["accept", "log"]);
  expect(r.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(head(await show(p, "log"))).toContain("proposed");
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(head(await show(p, "log"))).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "One file"]);
  let before = lines(p);
  const body = await p.werk([
    "propose",
    "log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "One file", new: "Two" }]),
  ]);
  expect(body.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  before = lines(p);
  const retitle = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(retitle.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const again = await p.werk(["add", "log", "--title", "Something else"]);
  expect(again.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  const s = await show(p, "log");
  expect(s.split("\n")[1]).toBe("Use a log");
  expect(head(s)).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = freshProject();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "One file"]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const n = lines(p).length;
  const r = await p.werk(["propose", "log", "--title", "Use an append-only log"]);
  expect(r.code).toBe(0);
  const now = lines(p);
  expect(now).toHaveLength(n + 1);
  const s = await show(p, "log");
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log\n");
  expect(s.split("\n")[1]).toBe("Use an append-only log");
  expect(readFileSync(logOf(p), "utf8").split("\n")[0]).toContain('"title":"Use a log"');
  await ok(p, [
    "propose",
    "log",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "One file", new: "One JSON file" }]),
  ]);
  const s2 = await show(p, "log");
  expect(s2).toContain("One JSON file");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = freshProject();
  seed(p, [card("store", "Storage")]);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "keep one log file" })}\n`,
  );
  const adds: [string, string[]][] = [
    ["store:opt0", ["add", "store:opt0", "--kind", "option", "--title", "Use SQLite", "--why_not", "native build"]],
    ["src", ["add", "src", "--kind", "source", "--title", "Bench", "--finding", "fast"]],
    ["store:ex0", ["quote", "store", "talk", "one log file"]],
  ];
  for (const [id, args] of adds) {
    const n = lines(p);
    const r = await ok(p, args);
    expect(r.out).toContain("proposed");
    const now = lines(p);
    expect(now).toHaveLength(n.length + 1);
    expect(now.slice(0, n.length)).toEqual(n);
    expect(head(await show(p, id))).toContain("proposed");
  }
  expect(await show(p, "store:opt0")).toContain("why not: native build");
  expect(await show(p, "src")).toContain("finding: fast");
  expect(await show(p, "store:ex0")).toContain("one log file");
  await ok(p, ["link", "store:opt0", "store", "--type", "alternative_to"]);
  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const opt = await show(p, "store:opt0");
  expect(head(opt)).not.toContain("proposed");
  expect(opt).toContain("why not: native build");
  expect(head(await show(p, "src"))).toContain("proposed");
  expect(head(await show(p, "store:ex0"))).toContain("proposed");
});

test("63.1 a link to a ghost is held, and goes live on accept with no extra link event", async () => {
  const p = freshProject();
  seed(p, [card("storage", "Storage", { status: "decided", who: "me", no_basis: "top" })]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["link", "sqlite", "storage", "--type", "depends_on", "--why", "stores what Storage names"]);
  expect(await show(p, "sqlite")).toMatch(/-> depends_on\s+storage\s+Storage\s+\(held\)/);
  const st = await show(p, "storage");
  for (const line of st.split("\n").filter((l) => /<- depends_on\s+sqlite/.test(l))) expect(line).toContain("held");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = await show(p, "sqlite");
  expect(s).toMatch(/-> depends_on\s+storage\s+Storage\n/);
  const linkEvents = events(p).filter(
    (e) => e.type === "edge.added" && e.payload.from === "sqlite" && e.payload.to === "storage",
  );
  expect(linkEvents).toHaveLength(1);
});

test("63.2 accepting a ghost child accepts its ghost parent, but not a ghost it depends on", async () => {
  const p = freshProject();
  seed(p, [card("platform", "Platform")]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "email", "--title", "Email service", "--parent", "platform"]);
  await ok(p, ["link", "magic", "email", "--type", "depends_on", "--why", "sends the link"]);
  await ok(p, ["accept", "magic", "--actor", "you"]);
  const m = await show(p, "magic");
  expect(head(m)).not.toContain("proposed");
  const a = await show(p, "auth");
  expect(head(a)).not.toContain("proposed");
  expect(a).toContain("parent: platform  Platform");
  expect(head(await show(p, "email"))).toContain("proposed");
  expect(m).toMatch(/-> depends_on\s+email\s+Email service[^\n]*held/);
});

test("63.3 an accept takes the card's own ghost options and sources with it", async () => {
  const p = freshProject();
  seed(p, [
    card("storage", "Storage", { status: "decided", who: "me", no_basis: "top" }),
    { type: "kill.added", payload: { id: "storage", criterion: { form: "revisit" } } },
  ]);
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "needs a server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "fast enough"]);
  await ok(p, ["link", "sqlite", "bench", "--type", "supported_by"]);
  const refusals: string[] = [];
  for (const args of [
    ["edit", "sqlite", "--who", "you"],
    ["kill", "sqlite", "--revisit"],
    ["status", "sqlite", "decided"],
  ]) {
    const r = await p.werk(args);
    if (r.code !== 0) refusals.push(`${args.join(" ")}: ${r.err}`);
  }
  expect(refusals).toEqual([]);
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const s = await show(p, "sqlite");
  expect(head(s)).toContain("[decided]");
  expect(head(s)).not.toContain("proposed");
  expect(s).toContain("who: you");
  const o = await show(p, "sqlite:opt0");
  expect(head(o)).not.toContain("proposed");
  expect(o).toContain("why not: needs a server");
  const b = await show(p, "bench");
  expect(head(b)).not.toContain("proposed");
  expect(b).toMatch(/<- supported_by\s+sqlite\s+Use SQLite\n/);
});

test("63.4 discarding a ghost parent discards its whole ghost branch", async () => {
  const p = freshProject();
  seed(p, [card("platform", "Platform")]);
  await ok(p, ["add", "auth", "--title", "Auth", "--parent", "platform"]);
  await ok(p, ["add", "magic", "--title", "Magic links", "--parent", "auth"]);
  await ok(p, ["add", "magic:opt0", "--kind", "option", "--title", "Passwords", "--why_not", "leaks"]);
  await ok(p, ["link", "magic:opt0", "magic", "--type", "alternative_to"]);
  await ok(p, ["discard", "auth"]);
  for (const id of ["auth", "magic", "magic:opt0"]) expect((await p.werk(["show", id])).code).not.toBe(0);
  const s = await show(p, "platform");
  expect(head(s)).not.toContain("proposed");
  expect(s).not.toContain("<- refines");
  expect(s).not.toContain("Auth");
});

test("63.5 a ghost changes no count of a real card until it is accepted", async () => {
  const p = freshProject();
  seed(p, [
    card("storage", "Storage", { status: "decided", who: "you", no_basis: "top", unchallenged: "only one" }),
    { type: "kill.added", payload: { id: "storage", criterion: { form: "revisit" } } },
    card("files", "Plain files", {
      status: "decided",
      who: "you",
      no_basis: "x",
      unchallenged: "y",
      parent: "storage",
    }),
    { type: "kill.added", payload: { id: "files", criterion: { form: "revisit" } } },
  ]);
  const rollup = (s: string) => s.split("\n").find((l) => l.startsWith("subtree:"));
  const before = await show(p, "storage");
  expect(rollup(before)).toBeDefined();
  expect(head(before)).not.toContain("stale");
  await ok(p, ["add", "sqlite", "--title", "Use SQLite", "--parent", "storage", "--who", "me"]);
  await ok(p, ["add", "sqlite:opt0", "--kind", "option", "--title", "Postgres", "--why_not", "server"]);
  await ok(p, ["link", "sqlite:opt0", "sqlite", "--type", "alternative_to"]);
  await ok(p, ["kill", "sqlite", "--revisit"]);
  await ok(p, ["status", "sqlite", "decided"]);
  expect(head(await show(p, "sqlite"))).toContain("[decided]");
  const mid = await show(p, "storage");
  expect(rollup(mid)).toBe(rollup(before));
  expect(head(mid)).not.toContain("stale");
  await ok(p, ["accept", "sqlite", "--actor", "you"]);
  const after = await show(p, "storage");
  expect(rollup(after)).not.toBe(rollup(before));
  expect(rollup(after)).toContain("3 cards");
  expect(after).toMatch(/<- refines\s+sqlite\s+Use SQLite/);
});
