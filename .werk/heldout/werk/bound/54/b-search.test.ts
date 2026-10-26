import { expect, test } from "bun:test";
import { world } from "./b-helpers.ts";

const lines = (out: string) => out.split("\n").filter((l) => l.trim() !== "");

test("09.1 an agent lists the index of decided cards", async () => {
  const w = world();
  w.card("root", "Root");
  w.decided("d1", "First decided", "root");
  w.decided("d2", "Second decided", "root");
  w.decided("d3", "Third decided", "root");
  w.card("o1", "An open card", "root");
  await w.ok("add", "g1", "--title", "A ghost card", "--parent", "root");
  w.seed("node.decided", { id: "g1" });
  const out = await w.ok("search");
  const ls = lines(out);
  for (const [id, title] of [["d1", "First decided"], ["d2", "Second decided"], ["d3", "Third decided"]]) {
    expect(ls.filter((l) => l.includes(id as string) && l.includes(title as string)).length).toBe(1);
  }
  expect(out).not.toContain("o1");
  expect(out).not.toContain("g1");
  expect(out).not.toContain("A ghost card");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const w = world();
  w.card("root", "Root");
  w.decided("cache-layout", "Cache layout", "root", { body: "Cache eviction follows the eviction policy." });
  w.card("eviction-timer", "Eviction timer", "root", { why: "eviction runs on a timer", body: "CACHE warmup first." });
  w.decided("cache-size", "Cache size", "root", { body: "The cache holds 100 entries." });
  w.card("old-cache", "Old cache eviction", "root", { body: "cache eviction" });
  await w.ok("remove", "old-cache", "--actor", "you");
  const ls = lines(await w.ok("search", "cache", "eviction"));
  expect(ls.length).toBe(2);
  expect(ls[0]).toMatch(/cache-layout\s+decided\s+Cache layout/);
  expect(ls[1]).toMatch(/eviction-timer\s+open\s+Eviction timer/);
  expect(ls.join("\n")).not.toContain("cache-size");
  expect(ls.join("\n")).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const w = world();
  w.card("root", "Root");
  w.decided("parent-topic", "Parent topic", "root");
  w.decided("storage-format", "Storage format", "parent-topic", { body: "One JSON line per event." });
  w.seed("node.added", { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" });
  w.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  w.card("elsewhere", "Elsewhere", "root", { body: "maybe sqlite later" });
  const all = await w.ok("search", "sqlite");
  expect(all).toMatch(/storage-format\s+decided\s+Storage format/);
  expect(all).toMatch(/elsewhere\s+open/);
  const under = lines(await w.ok("search", "sqlite", "--under", "parent-topic"));
  expect(under.length).toBe(1);
  expect(under[0]).toMatch(/storage-format/);
  const dec = lines(await w.ok("search", "sqlite", "--status", "decided"));
  expect(dec.length).toBe(1);
  expect(dec[0]).toMatch(/storage-format/);
});

test("09.4 an agent finds the open work under one card", async () => {
  const w = world();
  w.card("root", "Root");
  w.decided("client", "Client", "root");
  w.card("routing", "Routing", "client");
  w.card("theme", "Theme", "client", { status: "proto" });
  w.card("route-guards", "Route guards", "routing");
  w.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly URLs" });
  w.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  w.seed("node.added", { id: "router-src", kind: "source", title: "Router docs", finding: "history API" });
  w.seed("edge.added", { from: "routing", to: "router-src", type: "supported_by" });
  // Upstream cards in another tree, whose reopen marks the Client cards.
  w.decided("upstream", "Upstream");
  w.decided("p-base", "Pause base", "upstream");
  w.decided("s-base", "Stale base", "upstream");
  w.card("paused-card", "Paused card", "client");
  w.seed("edge.added", { from: "paused-card", to: "p-base", type: "depends_on", why: "needs p" });
  w.card("stale-card", "Stale card", "client");
  w.seed("edge.added", { from: "stale-card", to: "s-base", type: "depends_on", why: "needs s" });
  w.decided("postponed-card", "Postponed card", "client");
  w.seed("node.reopened", { id: "p-base", reason: "postponed" });
  w.seed("node.reopened", { id: "s-base", reason: "invalidated" });
  w.seed("node.reopened", { id: "postponed-card", reason: "postponed" });
  w.card("billing-root", "Billing tree");
  w.card("billing", "Billing", "billing-root");

  const r = lines(await w.ok("find", "routing"));
  expect(r[0]).toMatch(/^routing\s/);
  expect(r[1]).toMatch(/^route-guards\s/);
  const rj = r.join("\n");
  expect(rj).not.toContain("billing");
  expect(rj).not.toContain("routing:opt0");
  expect(rj).not.toContain("router-src");

  const c = lines(await w.ok("find", "client"));
  const ids = c.map((l) => l.split(/\s+/)[0]);
  const at = (id: string) => ids.indexOf(id);
  expect(at("routing")).toBeGreaterThanOrEqual(0);
  expect(at("theme")).toBeGreaterThanOrEqual(0);
  expect(at("route-guards")).toBeGreaterThan(at("routing"));
  expect(at("route-guards")).toBeGreaterThan(at("theme"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("paused-card");
  expect(ids).not.toContain("stale-card");
  expect(ids).not.toContain("postponed-card");
  // The test setup must have marked the three cards as described.
  const stale = await w.ok("stale");
  expect(stale).toContain("paused-card");
  expect(stale).toContain("stale-card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const w = world();
  w.card("tree-a", "Tree A");
  w.decided("tree-a-done", "Done A", "tree-a");
  w.card("tree-a-open", "Open A", "tree-a");
  w.decided("tree-b", "Tree B");
  w.card("tree-b-open", "Open B", "tree-b");
  w.decided("auth-flow", "Auth flow", "tree-b");
  w.seed("node.reopened", { id: "auth-flow", reason: "rejected" });
  const out = await w.ok("find");
  const ids = lines(out).map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("tree-a-open");
  expect(ids).toContain("tree-b-open");
  expect(ids).toContain("auth-flow");
  expect(lines(out).some((l) => /\sdecided\s/.test(l))).toBe(false);
});
