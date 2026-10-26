import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Project } from "../../src/test-env/project.ts";
import { decided, ghost, makeProject, real, werkIn, writeLines } from "./helpers.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = makeProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());
const seed = (...evs: unknown[]) => writeLines(project.logPath, evs.flat());
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

// ---------- 09 ----------
test("09.1 search with no term lists the decided cards only", async () => {
  seed(
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    real("o1", { title: "Open card" }),
    // a ghost whose recorded status is decided (hand-written: add refuses decided)
    ghost("g1", { title: "Ghost card", status: "decided" }),
  );
  const r = await werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const id of ["d1", "d2", "d3"]) expect(out.some((l) => l.startsWith(`${id}  `))).toBe(true);
  expect(r.stdout).toContain("Decided one");
  expect(r.stdout).not.toContain("Open card");
  expect(r.stdout).not.toContain("Ghost card");
});

test("09.2 search with two terms puts the best match first", async () => {
  seed(
    decided("cl", { title: "Cache layout", why: "layout", body: "Cache eviction and eviction policy" }),
    real("et", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cs", { title: "Cache size", why: "size", body: "how big" }),
    decided("rm", { title: "Removed", body: "cache eviction" }),
    { type: "node.removed", id: "rm", actor: "you" },
  );
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatch(/^cl\s+\[decided\]\s+Cache layout$/);
  expect(out[1]).toMatch(/^et\s+\[open\]\s+Eviction timer$/);
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Removed");
});

test("09.3 search finds a word in a rejected option and narrows by --under and --status", async () => {
  seed(
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    real("opt", { kind: "option", title: "SQLite", why: "SQLite needs a native build" }),
    { type: "edge.added", from: "opt", to: "storage", link: "alternative_to" },
    real("elsewhere", { title: "Elsewhere", body: "we might use sqlite here" }),
  );
  const all = await werk("search", "sqlite");
  expect(all.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
  expect(all.stdout).toMatch(/elsewhere\s+\[open\]/);
  const under = await werk("search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const status = await werk("search", "sqlite", "--status", "decided");
  expect(lines(status.stdout)).toHaveLength(1);
  expect(status.stdout).toContain("Storage format");
});

const reopenAt = (id: string, reason: string) => ({ type: "node.reopened", id, reason, at: "2026-10-10T09:00:00.000Z" });

test("09.4 find lists the open work under one card", async () => {
  seed(
    decided("client", { title: "Client" }),
    real("routing", { title: "Routing", parent: "client" }),
    real("theme", { title: "Theme", parent: "client", status: "proto" }),
    real("guards", { title: "Route guards", parent: "routing" }),
    // postponed child, paused child (depends on the postponed one), stale child (depends on a reopened card)
    decided("cpost", { title: "Postponed card", parent: "client" }),
    real("cpause", { title: "Paused card", parent: "client" }),
    { type: "edge.added", from: "cpause", to: "cpost", link: "depends_on", why: "needs it" },
    decided("outside", { title: "Outside" }),
    real("cstale", { title: "Stale card", parent: "client" }),
    { type: "edge.added", from: "cstale", to: "outside", link: "depends_on", why: "needs outside" },
    reopenAt("cpost", "postponed"),
    reopenAt("outside", "invalidated"),
    real("ropt", { kind: "option", title: "Router option", why: "no" }),
    { type: "edge.added", from: "ropt", to: "routing", link: "alternative_to" },
    real("rsrc", { kind: "source", title: "Router source" }),
    { type: "edge.added", from: "routing", to: "rsrc", link: "supported_by" },
    real("billing", { title: "Billing" }),
  );
  const r = await werk("find", "routing");
  const out = lines(r.stdout);
  expect(out[0]).toMatch(/^routing\s/);
  expect(out[1]).toMatch(/^guards\s/);
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("Router option");
  expect(r.stdout).not.toContain("Router source");
  const c = await werk("find", "client");
  const ids = lines(c.stdout).map((l) => l.split(/\s+/)[0]);
  expect(ids.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("routing"));
  expect(ids.indexOf("guards")).toBeGreaterThan(ids.indexOf("theme"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("cpause");
  expect(ids).not.toContain("cstale");
  expect(ids).not.toContain("cpost");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(
    real("t1", { title: "Tree one" }),
    real("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    reopenAt("auth", "rejected"),
  );
  const r = await werk("find");
  expect(r.stdout).toMatch(/^t1\s/m);
  expect(r.stdout).toMatch(/^t2\s/m);
  expect(r.stdout).toMatch(/^auth\s+\[open\]\s+Auth flow/m);
  expect(r.stdout).not.toContain("[decided]");
});

// ---------- 11 ----------
test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seed(
    decided("root", { title: "Root" }),
    // c1 is decided with its grandchild, then reopened: the contract does not let a card
    // be decided under an open parent, so this is how a decided grandchild sits under an open child.
    decided("c1", { title: "C1", parent: "root" }),
    real("c2", { title: "C2", parent: "root", status: "proto" }),
    decided("g", { title: "G", parent: "c1" }),
    reopenAt("c1", "invalidated"),
  );
  const r = await werk("show", "root");
  const rl = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rl).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(
    decided("parent", { title: "Parent" }),
    decided("child", { title: "Child", parent: "parent" }),
    real("g1", { title: "G1", parent: "child" }),
    decided("g2", { title: "G2", parent: "child" }),
    reopenAt("child", "invalidated"),
  );
  const r = await werk("show", "parent");
  expect(r.stdout).toContain("rollup: 4 cards:");
  expect(r.stdout).toMatch(/<- refines\s+child\s+Child\s+\(rollup: 3 cards:/);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  seed(
    decided("other", { title: "Other" }),
    decided("card", { title: "Card" }),
    { type: "edge.added", from: "card", to: "other", link: "depends_on", why: "needs other for X" },
    real("opt", { kind: "option", title: "Option title", why: "too slow" }),
    { type: "edge.added", from: "opt", to: "card", link: "alternative_to" },
    { type: "excerpt.quoted", id: "card:ex0", title: "the exact words", card: "card", conversation: "c", session: "s", message: 1, start: 0, end: 5, speaker: "person", said_at: "10:00" },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    ghost("src", { kind: "source", title: "Source title", why: "the finding" }),
    { type: "edge.added", from: "card", to: "src", link: "supported_by" },
  );
  const r = await werk("show", "card");
  const out = r.stdout;
  expect(r.code).toBe(0);
  expect(out).toMatch(/-> depends_on\s+other/);
  expect(out).toContain("why: needs other for X");
  const iLink = out.indexOf("-> depends_on");
  const iOpt = out.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(out).toMatch(/Options:\n\s+opt\s+Option title\n\s+why not: too slow/);
  expect(out).toMatch(/Say:\n\s+person: the exact words/);
  expect(out).toMatch(/Ev:\n\s+src\s+Source title\s+proposed\n\s+finding: the finding/);
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(
    decided("card", { title: "Card" }),
    { type: "excerpt.quoted", id: "card:ex0", title: "words", card: "card", conversation: "c", session: "s", message: 1, start: 0, end: 5, speaker: "person", said_at: "10:00" },
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    real("src", { kind: "source", title: "Src", why: "f" }),
    { type: "edge.added", from: "card", to: "src", link: "supported_by" },
  );
  const r = await werk("show", "card");
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options:");
});

test("11.5 show with no id prints the root card", async () => {
  seed(decided("root", { title: "The Root" }), real("kid", { title: "Kid", parent: "root" }));
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/rollup: 2 cards:/);
  expect(r.stdout).toMatch(/<- refines\s+kid\s+Kid\s+\(rollup: 1 cards:/);
});
