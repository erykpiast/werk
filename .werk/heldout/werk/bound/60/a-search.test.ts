import { expect, test } from "bun:test";
import { card, map } from "./a-helpers.ts";

const lines = (s: string) => s.split("\n").filter(Boolean);

test("09.1 an agent lists the index of decided cards", async () => {
  const m = map();
  card(m, "d1", "Decided one", "root", { status: "decided" });
  card(m, "d2", "Decided two", "root", { status: "decided" });
  card(m, "d3", "Decided three", "root", { status: "decided" });
  card(m, "o1", "Open one", "root");
  m.seed("node.proposed", { id: "g1", kind: "card", title: "Ghost one", parent: "root", status: "decided" }, "agent");
  const r = await m.w("search");
  expect(r.code).toBe(0);
  const out = lines(r.out);
  expect(out.length).toBe(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]])
    expect(out.some((l) => l.includes(id as string) && l.includes(t as string))).toBe(true);
  expect(r.out).not.toContain("o1");
  expect(r.out).not.toContain("g1");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const m = map();
  card(m, "cache-layout", "Cache layout", "root", {
    status: "decided",
    body: "Cache eviction runs hourly. The eviction policy is LRU.",
  });
  card(m, "eviction-timer", "Eviction timer", "root", { why: "eviction must be timely", body: "CACHE warmup first." });
  card(m, "cache-size", "Cache size", "root", { status: "decided", body: "The cache holds 1 GB." });
  card(m, "old-cache", "Old cache eviction", "root", { body: "cache eviction" });
  expect((await m.w("remove", "old-cache", "--actor", "you")).code).toBe(0);
  const r = await m.w("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.out);
  expect(out.length).toBe(2);
  expect(out[0]).toMatch(/cache-layout\s+decided\s+Cache layout/);
  expect(out[1]).toMatch(/eviction-timer\s+open\s+Eviction timer/);
  expect(r.out).not.toContain("cache-size");
  expect(r.out).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const m = map();
  card(m, "parent-topic", "Parent topic", "root", { status: "decided" });
  card(m, "storage-format", "Storage format", "parent-topic", { status: "decided" });
  m.seed("node.added", { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" });
  m.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  card(m, "other-open", "Other open", "root", { body: "maybe sqlite later" });
  const r = await m.w("search", "sqlite");
  expect(r.out).toMatch(/storage-format\s+decided\s+Storage format/);
  expect(r.out).toContain("other-open");
  const u = await m.w("search", "sqlite", "--under", "parent-topic");
  expect(lines(u.out).length).toBe(1);
  expect(u.out).toContain("storage-format");
  const s = await m.w("search", "sqlite", "--status", "decided");
  expect(lines(s.out).length).toBe(1);
  expect(s.out).toContain("storage-format");
});

test("09.4 an agent finds the open work under one card", async () => {
  const m = map();
  card(m, "client", "Client", "root", { status: "decided" });
  card(m, "routing", "Routing", "client");
  card(m, "theme", "Theme", "client", { status: "proto" });
  card(m, "route-guards", "Route guards", "routing");
  // postponed: a decided child reopened as postponed
  card(m, "postponed-card", "Postponed card", "client", { status: "decided" });
  // paused: depends on the postponed card
  card(m, "paused-card", "Paused card", "client");
  m.seed("edge.added", { from: "paused-card", to: "postponed-card", type: "depends_on", why: "needs it" });
  // stale: depends on a decided card elsewhere that is reopened as invalidated
  card(m, "elsewhere", "Elsewhere", "root", { status: "decided" });
  card(m, "stale-card", "Stale card", "client");
  m.seed("edge.added", { from: "stale-card", to: "elsewhere", type: "depends_on", why: "needs it" });
  m.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "ugly" });
  m.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  m.seed("node.added", { id: "routing-src", kind: "source", title: "Router doc", url: "https://example.invalid", finding: "f" });
  m.seed("edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  m.seed("node.added", { id: "other-root", kind: "card", title: "Other root", status: "decided" });
  card(m, "billing", "Billing", "other-root");
  expect((await m.w("reopen", "postponed-card", "--reason", "postponed", "--why", "later")).code).toBe(0);
  expect((await m.w("reopen", "elsewhere", "--reason", "invalidated", "--why", "wrong")).code).toBe(0);
  // check marks are as the step describes
  const st = await m.w("stale");
  expect(st.out).toContain("stale-card");
  expect(st.out).toContain("paused-card");

  const r = await m.w("find", "routing");
  const out = lines(r.out);
  expect(out[0]).toContain("routing");
  expect(out[1]).toContain("route-guards");
  expect(r.out).not.toContain("billing");
  expect(r.out).not.toContain("routing:opt0");
  expect(r.out).not.toContain("routing-src");

  const c = await m.w("find", "client");
  const ids = lines(c.out).map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("routing");
  expect(ids).toContain("theme");
  expect(ids.indexOf("routing")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids.indexOf("theme")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("paused-card");
  expect(ids).not.toContain("stale-card");
  expect(ids).not.toContain("postponed-card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const m = map();
  card(m, "tree1-open", "Tree one open", "root");
  m.seed("node.added", { id: "root2", kind: "card", title: "Root two", status: "decided" });
  card(m, "tree2-open", "Tree two open", "root2");
  card(m, "auth-flow", "Auth flow", "root", { status: "decided" });
  card(m, "decided-x", "Decided x", "root2", { status: "decided" });
  expect((await m.w("reopen", "auth-flow", "--reason", "rejected", "--why", "wrong")).code).toBe(0);
  const r = await m.w("find");
  expect(r.out).toContain("tree1-open");
  expect(r.out).toContain("tree2-open");
  expect(r.out).toContain("auth-flow");
  for (const l of lines(r.out)) expect(l).not.toMatch(/\sdecided\s/);
});
