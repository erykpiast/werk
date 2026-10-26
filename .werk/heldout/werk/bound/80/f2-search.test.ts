import { expect, test } from "bun:test";
import { mk } from "./lib.ts";

const ids = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim());

test("09.1 search with no term lists decided cards only", async () => {
  const h = mk();
  h.card("d1", { title: "Decided one", status: "decided" });
  h.card("d2", { title: "Decided two", status: "decided" });
  h.card("d3", { title: "Decided three", status: "decided" });
  h.card("o1", { title: "Open one" });
  h.seed("node.proposed", { id: "g1", kind: "card", title: "Ghost decided", parent: "root", status: "decided" }, "agent");
  const r = await h.w("search");
  expect(r.code).toBe(0);
  const lines = ids(r.out);
  expect(lines.length).toBe(3);
  for (const id of ["d1", "d2", "d3"]) expect(r.out).toContain(id);
  expect(r.out).toContain("Decided one");
  expect(r.out).not.toContain("o1");
  expect(r.out).not.toContain("Open one");
  expect(r.out).not.toContain("g1");
  expect(r.out).not.toContain("Ghost");
});

test("09.2 search with two terms ranks by hits", async () => {
  const h = mk();
  h.card("cache-layout", {
    title: "Cache layout",
    status: "decided",
    body: "Cache eviction\n\neviction policy",
  });
  h.card("evict-timer", { title: "Eviction timer", status: "open", why: "eviction", body: "CACHE warmup" });
  h.card("cache-size", { title: "Cache size", status: "decided", body: "cache" });
  h.card("gone", { title: "Gone", status: "decided", body: "cache eviction" });
  h.seed("node.removed", { id: "gone" });
  const r = await h.w("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const lines = ids(r.out);
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("evict-timer");
  expect(lines[1]).toContain("open");
  expect(r.out).not.toContain("cache-size");
  expect(r.out).not.toContain("gone");
});

async function sqliteMap() {
  const h = mk();
  h.card("parent-topic", { title: "Parent topic", status: "decided" });
  h.card("storage-format", { title: "Storage format", status: "decided", parent: "parent-topic" });
  h.seed("node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "Use a database",
    why_not: "SQLite needs a native build",
  });
  h.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  h.card("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" });
  return h;
}

test("09.3 search finds a card by a rejected option word and narrows", async () => {
  const h = await sqliteMap();
  const a = await h.w("search", "sqlite");
  expect(a.out).toContain("storage-format");
  expect(a.out).toContain("decided");
  expect(a.out).toContain("elsewhere");
  const b = await h.w("search", "sqlite", "--under", "parent-topic");
  expect(b.code).toBe(0);
  expect(b.out).toContain("storage-format");
  expect(b.out).not.toContain("elsewhere");
  const c = await h.w("search", "sqlite", "--status", "decided");
  expect(c.out).toContain("storage-format");
  expect(c.out).not.toContain("elsewhere");
});

async function clientMap() {
  const h = mk();
  h.card("client", { title: "Client", status: "decided" });
  h.card("routing", { title: "Routing", parent: "client" });
  h.card("theme", { title: "Theme", parent: "client", status: "proto" });
  h.card("route-guards", { title: "Route guards", parent: "routing" });
  h.card("base", { title: "Base", status: "decided" });
  h.card("pausedc", { title: "Paused card", parent: "client" });
  h.card("stalec", { title: "Stale card", parent: "client" });
  h.card("postc", { title: "Postponed card", parent: "client" });
  h.card("billing", { title: "Billing" });
  h.seed("node.added", { id: "routing:opt0", kind: "option", title: "Opt", why_not: "no" });
  h.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  h.seed("node.added", { id: "routing:src", kind: "source", title: "Src" });
  h.seed("edge.added", { from: "routing", to: "routing:src", type: "supported_by" });
  return h;
}

test("09.4 find lists the open work under a card", async () => {
  const h = await clientMap();
  // paused: depends on a postponed card; stale: depends on a rejected card; postponed: a card that was reopened as postponed
  h.card("x1", { title: "X1", status: "decided" });
  h.card("x2", { title: "X2", status: "decided" });
  h.seed("edge.added", { from: "pausedc", to: "x1", type: "depends_on", why: "needs x1" });
  h.seed("edge.added", { from: "stalec", to: "x2", type: "depends_on", why: "needs x2" });
  h.seed("node.reopened", { id: "x1", reason: "postponed", why: "later" });
  h.seed("node.reopened", { id: "x2", reason: "rejected", why: "bad" });
  h.card("postbase", { title: "Post base", status: "decided" });
  h.seed("edge.added", { from: "postc", to: "postbase", type: "depends_on", why: "needs" });
  h.seed("node.reopened", { id: "postbase", reason: "postponed", why: "later" });
  h.card("pc2", { title: "Postponed itself", parent: "client", status: "decided" });
  h.seed("node.reopened", { id: "pc2", reason: "postponed", why: "later" });
  const r = await h.w("find", "routing");
  expect(r.code).toBe(0);
  const l = ids(r.out);
  expect(l[0]).toContain("routing");
  expect(l[1]).toContain("route-guards");
  expect(r.out).not.toContain("billing");
  expect(r.out).not.toContain("routing:opt0");
  expect(r.out).not.toContain("routing:src");
  const c = await h.w("find", "client");
  const t = c.out;
  expect(t.indexOf("routing")).toBeGreaterThan(-1);
  expect(t.indexOf("theme")).toBeGreaterThan(-1);
  expect(t.indexOf("route-guards")).toBeGreaterThan(t.indexOf("routing"));
  expect(t.indexOf("route-guards")).toBeGreaterThan(t.indexOf("theme"));
  expect(ids(t).some((x) => x.startsWith("client") || x.includes("  client"))).toBe(false);
  expect(t).not.toContain("pausedc");
  expect(t).not.toContain("stalec");
  expect(t).not.toContain("postc");
  expect(t).not.toContain("pc2");
});

test("09.5 a card reopened as rejected comes back in find", async () => {
  const h = mk();
  h.card("t1", { title: "Tree one", parent: "root" });
  h.card("t2", { title: "Tree two", parent: "root" });
  h.card("auth-flow", { title: "Auth flow", status: "decided" });
  h.seed("node.reopened", { id: "auth-flow", reason: "rejected", why: "wrong" });
  const r = await h.w("find");
  expect(r.code).toBe(0);
  expect(r.out).toContain("t1");
  expect(r.out).toContain("t2");
  expect(r.out).toContain("auth-flow");
  expect(r.out).not.toMatch(/decided/);
});

test("66.4 find lists workable open cards in a subtree", async () => {
  const h = mk();
  h.card("storage", { title: "Storage", status: "decided" });
  for (const id of ["cache", "index", "backup", "quota"]) h.card(id, { title: id, parent: "storage" });
  h.card("p", { title: "P", status: "decided" });
  h.card("r", { title: "R", status: "decided" });
  h.seed("edge.added", { from: "backup", to: "p", type: "depends_on", why: "w" });
  h.seed("edge.added", { from: "quota", to: "r", type: "depends_on", why: "w" });
  h.seed("node.reopened", { id: "p", reason: "postponed", why: "later" });
  h.seed("node.reopened", { id: "r", reason: "rejected", why: "bad" });
  h.card("outside", { title: "outside" });
  const out = (await h.w("find", "storage")).out;
  expect(out).toContain("cache");
  expect(out).toContain("index");
  expect(out).not.toContain("backup");
  expect(out).not.toContain("quota");
  expect(out).not.toContain("outside");
});

test("66.5 removed branch drops out of find and returns after restore", async () => {
  const h = mk();
  h.card("storage", { title: "Storage", status: "decided" });
  h.card("cache", { title: "Cache", parent: "storage" });
  h.card("index", { title: "Index", parent: "storage" });
  expect((await h.w("remove", "cache", "--actor", "you")).code).toBe(0);
  let out = (await h.w("find", "storage")).out;
  expect(out).toContain("index");
  expect(out).not.toContain("cache");
  expect((await h.w("restore", "cache", "--actor", "you")).code).toBe(0);
  out = (await h.w("find", "storage")).out;
  expect(out).toContain("cache");
  expect(out).toContain("index");
});
