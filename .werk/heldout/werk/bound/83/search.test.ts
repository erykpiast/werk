import { expect, test } from "bun:test";
import { ok, real, seed, withRoot } from "./lib.ts";

const decided = (id: string, parent = "root", extra = {}) =>
  real(id, parent, { status: "decided", who: "me", no_basis: "x", ...extra });
const open = (id: string, parent = "root", extra = {}) => real(id, parent, { status: "open", ...extra });
const dep = (from: string, to: string) => ({ type: "edge.added", payload: { from, to, type: "depends_on", why: "w" } });
const reopen = (id: string, reason: string) => ({ type: "node.reopened", payload: { id, reason, why: "because" } });
const lines = (s: string) => s.split("\n").filter(Boolean);

test("09.1 the index lists decided cards only", async () => {
  const p = withRoot([
    decided("d1", "root", { title: "Dec one" }),
    decided("d2", "root", { title: "Dec two" }),
    decided("d3", "root", { title: "Dec three" }),
    open("o1", "root", { title: "Open one" }),
    { type: "node.proposed", payload: { id: "g1", kind: "card", title: "Ghost one", status: "decided", parent: "root" } },
  ]);
  const out = (await ok(p, ["search"])).out;
  // the root is a decided card too
  const ls = lines(out);
  for (const t of ["d1  Dec one", "d2  Dec two", "d3  Dec three"]) expect(ls).toContain(t);
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("Ghost one");
  expect(ls.filter((l) => !l.startsWith("root")).length).toBe(3);
});

test("09.2 two terms, best match first", async () => {
  const p = withRoot([
    decided("layout", "root", { title: "Cache layout", body: "Cache eviction\n\nThe eviction policy." }),
    open("timer", "root", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("size", "root", { title: "Cache size" }),
    open("gone", "root", { title: "Gone", body: "cache eviction" }),
  ]);
  await ok(p, ["remove", "gone", "--actor", "you"]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  const ls = lines(out);
  expect(ls.length).toBe(2);
  expect(ls[0]).toMatch(/^layout\s+decided\s+Cache layout$/);
  expect(ls[1]).toMatch(/^timer\s+open\s+Eviction timer$/);
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("Gone");
});

test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
  const p = withRoot([
    decided("parent", "root", { title: "Parent topic" }),
    decided("storage", "parent", { title: "Storage format" }),
    real("storage:opt0", undefined, { kind: "option", title: "Use SQLite", why_not: "SQLite needs a native build" }),
    { type: "edge.added", payload: { from: "storage:opt0", to: "storage", type: "alternative_to" } },
    open("other", "root", { title: "Other card", body: "we could use sqlite here" }),
  ]);
  const a = lines((await ok(p, ["search", "sqlite"])).out);
  expect(a.some((l) => /^storage\s+decided\s+Storage format/.test(l))).toBe(true);
  expect(a.some((l) => /^other\s+open/.test(l))).toBe(true);
  const b = lines((await ok(p, ["search", "sqlite", "--under", "parent"])).out);
  expect(b.length).toBe(1);
  expect(b[0]).toMatch(/^storage/);
  const c = lines((await ok(p, ["search", "sqlite", "--status", "decided"])).out);
  expect(c.length).toBe(1);
  expect(c[0]).toMatch(/^storage/);
});

test("09.4 find the open work under one card", async () => {
  const p = withRoot([
    decided("client", "root", { title: "Client" }),
    open("routing", "client", { title: "Routing" }),
    real("theme", "client", { title: "Theme", status: "proto" }),
    open("guards", "routing", { title: "Route guards" }),
    decided("post", "client", { title: "Postponed card" }),
    open("paused", "client", { title: "Paused card" }),
    decided("rej", "root", { title: "Rejected basis" }),
    open("stale", "client", { title: "Stale card" }),
    real("routing:opt0", undefined, { kind: "option", title: "Opt", why_not: "n" }),
    { type: "edge.added", payload: { from: "routing:opt0", to: "routing", type: "alternative_to" } },
    real("src1", undefined, { kind: "source", title: "Src", finding: "f" }),
    { type: "edge.added", payload: { from: "routing", to: "src1", type: "supported_by" } },
    open("billing", "root", { title: "Billing" }),
    dep("paused", "post"),
    dep("stale", "rej"),
    reopen("post", "postponed"),
    reopen("rej", "rejected"),
  ]);
  const r = (await ok(p, ["find", "routing"])).out;
  expect(r.indexOf("Routing")).toBeGreaterThanOrEqual(0);
  expect(r.indexOf("Route guards")).toBeGreaterThan(r.indexOf("Routing"));
  for (const bad of ["Billing", "Opt", "Src"]) expect(r).not.toContain(bad);
  const c = (await ok(p, ["find", "client"])).out;
  expect(c).toContain("Routing");
  expect(c).toContain("Theme");
  expect(c.indexOf("Route guards")).toBeGreaterThan(c.indexOf("Routing"));
  expect(c.indexOf("Route guards")).toBeGreaterThan(c.indexOf("Theme"));
  expect(c).not.toMatch(/^client\s/m);
  for (const bad of ["Paused card", "Stale card", "Postponed card"]) expect(c).not.toContain(bad);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = withRoot([
    open("c1", "root", { title: "Open in tree one" }),
    real("root2", undefined, { title: "Second root", status: "decided", who: "me", no_basis: "x" }),
    open("c2", "root2", { title: "Open in tree two" }),
    decided("auth", "root", { title: "Auth flow" }),
    reopen("auth", "rejected"),
  ]);
  const out = (await ok(p, ["find"])).out;
  expect(out).toContain("Open in tree one");
  expect(out).toContain("Open in tree two");
  expect(out).toContain("Auth flow");
  expect(out).not.toMatch(/\sdecided\s/);
});

test("66.4 find the open cards that can be worked on in a subtree", async () => {
  const p = withRoot([
    open("storage", "root", { title: "Storage" }),
    open("cache", "storage", { title: "Cache" }),
    open("index", "storage", { title: "Index" }),
    open("backup", "storage", { title: "Backup" }),
    open("quota", "storage", { title: "Quota" }),
    decided("pp", "root", { title: "Postponed basis" }),
    decided("rr", "root", { title: "Rejected basis" }),
    open("outside", "root", { title: "Outside" }),
    dep("backup", "pp"),
    dep("quota", "rr"),
    reopen("pp", "postponed"),
    reopen("rr", "rejected"),
  ]);
  const out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("Cache");
  expect(out).toContain("Index");
  for (const bad of ["Backup", "Quota", "Outside"]) expect(out).not.toContain(bad);
});
