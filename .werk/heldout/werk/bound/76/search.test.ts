import { expect, test } from "bun:test";
import { card, events, ok, seed, withRoot } from "./h.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});
const idsOf = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);

test("09.1 search with no term lists decided cards only", async () => {
  const p = withRoot();
  seed(p, [
    card("d1", "Decided one", { status: "decided", parent: "root" }),
    card("d2", "Decided two", { status: "decided", parent: "root" }),
    card("d3", "Decided three", { status: "decided", parent: "root" }),
    card("o1", "Open one", { parent: "root" }),
    { type: "node.proposed", payload: { id: "g1", kind: "card", title: "Ghost decided", status: "decided", parent: "root" } },
  ]);
  const out = (await ok(p, "search")).out;
  expect(out).toContain("d1  Decided one");
  expect(out).toContain("d2  Decided two");
  expect(out).toContain("d3  Decided three");
  expect(out).not.toContain("o1");
  expect(out).not.toContain("g1");
  expect(out.split("\n").filter(Boolean).length).toBe(3);
});

test("09.2 two terms, best match first", async () => {
  const p = withRoot();
  seed(p, [
    card("layout", "Cache layout", { status: "decided", body: "Cache eviction and eviction policy", parent: "root" }),
    card("timer", "Eviction timer", { why: "eviction", body: "CACHE warmup", parent: "root" }),
    card("size", "Cache size", { status: "decided", parent: "root" }),
    card("gone", "Cache eviction gone", { parent: "root" }),
  ]);
  await ok(p, "remove", "gone", "--actor", "you");
  const out = (await ok(p, "search", "cache", "eviction")).out;
  const ls = out.split("\n").filter(Boolean);
  expect(ls.length).toBe(2);
  expect(ls[0]).toMatch(/^layout\s+decided\s+Cache layout$/);
  expect(ls[1]).toMatch(/^timer\s+open\s+Eviction timer$/);
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("gone");
});

test("09.3 option word, --under and --status narrow", async () => {
  const p = withRoot();
  seed(p, [
    card("parent", "Parent topic", { status: "decided", parent: "root" }),
    card("storage", "Storage format", { status: "decided", parent: "parent" }),
    { type: "node.added", payload: { id: "o", kind: "option", title: "Use SQLite alt", why_not: "SQLite needs a native build" } },
    edge("o", "storage", "alternative_to"),
    card("elsewhere", "Elsewhere", { body: "we could use sqlite here", parent: "root" }),
  ]);
  // the option title has "SQLite" too in my fixture; keep title neutral to match the step
  const all = (await ok(p, "search", "sqlite")).out;
  expect(all).toMatch(/storage\s+decided\s+Storage format/);
  expect(all).toMatch(/elsewhere\s+open\s+Elsewhere/);
  const under = (await ok(p, "search", "sqlite", "--under", "parent")).out;
  expect(under.trim().split("\n")).toEqual([expect.stringMatching(/^storage\s+decided\s+Storage format$/)]);
  const st = (await ok(p, "search", "sqlite", "--status", "decided")).out;
  expect(st.trim().split("\n")).toEqual([expect.stringMatching(/^storage\s+decided\s+Storage format$/)]);
});

function clientMap() {
  const p = withRoot();
  seed(p, [
    card("client", "Client", { status: "decided", parent: "root" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { status: "proto", parent: "client" }),
    card("guards", "Route guards", { parent: "routing" }),
    card("billing", "Billing", { parent: "root" }),
    // reopened upstream cards
    card("up-post", "Upstream postponed", { status: "decided", parent: "root" }),
    card("up-rej", "Upstream rejected", { status: "decided", parent: "root" }),
    card("paused", "Paused card", { parent: "client" }),
    card("stale", "Stale card", { parent: "client" }),
    card("postponed", "Postponed card", { status: "decided", parent: "client" }),
    edge("paused", "up-post", "depends_on", "needs"),
    edge("stale", "up-rej", "depends_on", "needs"),
    { type: "node.reopened", payload: { id: "up-post", reason: "postponed", why: "later" } },
    { type: "node.reopened", payload: { id: "up-rej", reason: "rejected", why: "wrong" } },
    { type: "node.reopened", payload: { id: "postponed", reason: "postponed", why: "later" } },
    { type: "node.added", payload: { id: "opt", kind: "option", title: "An option", why_not: "no" } },
    edge("opt", "routing", "alternative_to"),
    { type: "node.added", payload: { id: "src", kind: "source", title: "A source" } },
    edge("routing", "src", "supported_by"),
  ]);
  return p;
}

test("09.4 find open work under one card", async () => {
  const p = clientMap();
  const r = idsOf((await ok(p, "find", "routing")).out);
  expect(r.slice(0, 2)).toEqual(["routing", "guards"]);
  for (const bad of ["billing", "opt", "src"]) expect(r).not.toContain(bad);
  const c = idsOf((await ok(p, "find", "client")).out);
  expect(c).toContain("routing");
  expect(c).toContain("theme");
  expect(c.indexOf("guards")).toBeGreaterThan(c.indexOf("routing"));
  expect(c.indexOf("guards")).toBeGreaterThan(c.indexOf("theme"));
  expect(c).not.toContain("client");
  for (const bad of ["paused", "stale", "postponed"]) expect(c).not.toContain(bad);
});

test("09.5 a card reopened as rejected is work in every tree", async () => {
  const p = withRoot();
  seed(p, [
    card("t1", "Tree one", { parent: "root" }),
    card("t2", "Tree two", { parent: "root" }),
    card("flow", "Auth flow", { status: "decided", parent: "root" }),
    { type: "node.reopened", payload: { id: "flow", reason: "rejected", why: "bad" } },
  ]);
  const out = (await ok(p, "find")).out;
  const ids = idsOf(out);
  expect(ids).toContain("t1");
  expect(ids).toContain("t2");
  expect(ids).toContain("flow");
  expect(out).not.toContain("decided");
});

test("66.4 find the open cards it can work on in a subtree", async () => {
  const p = withRoot();
  seed(p, [
    card("storage", "Storage", { parent: "root" }),
    card("cache", "Cache", { parent: "storage" }),
    card("index", "Index", { parent: "storage" }),
    card("backup", "Backup", { parent: "storage" }),
    card("quota", "Quota", { parent: "storage" }),
    card("outside", "Outside", { parent: "root" }),
    card("up-post", "Up post", { status: "decided", parent: "root" }),
    card("up-rej", "Up rej", { status: "decided", parent: "root" }),
    edge("backup", "up-post", "depends_on", "x"),
    edge("quota", "up-rej", "depends_on", "x"),
    { type: "node.reopened", payload: { id: "up-post", reason: "postponed" } },
    { type: "node.reopened", payload: { id: "up-rej", reason: "rejected" } },
  ]);
  const ids = idsOf((await ok(p, "find", "storage")).out);
  expect(ids).toContain("cache");
  expect(ids).toContain("index");
  for (const bad of ["backup", "quota", "outside"]) expect(ids).not.toContain(bad);
  void events;
});
