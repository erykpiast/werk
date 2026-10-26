import { afterEach, beforeEach, expect, test } from "bun:test";
import { card, createProject, decided, ev, link, type Project, raw, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists the decided index", async () => {
  decided(p, "d1", "Decided one");
  decided(p, "d2", "Decided two");
  decided(p, "d3", "Decided three");
  card(p, "o1", "Open one");
  raw(p, { type: "node.proposed", id: "g1", kind: "card", title: "Ghost one", status: "decided" });
  const r = await werk(p, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(out.some((l) => l.includes(id) && l.includes(t))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 two terms, best match first", async () => {
  decided(p, "layout", "Cache layout", { body: "Cache eviction\n\neviction policy" });
  card(p, "timer", "Eviction timer", { why: "eviction", body: "CACHE warmup" });
  decided(p, "size", "Cache size", { why: "cache" });
  card(p, "gone", "Gone", { body: "cache eviction" });
  ev(p, { type: "node.removed", id: "gone" });
  const r = await werk(p, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 a word in a rejected option, narrowed", async () => {
  decided(p, "parent", "Parent topic");
  decided(p, "storage", "Storage format", { parent: "parent" });
  card(p, "storage:opt0", "Use a database", { kind: "option", why: "SQLite needs a native build" });
  link(p, "storage:opt0", "storage", "alternative_to");
  card(p, "elsewhere", "Elsewhere", { body: "sqlite" });
  const r = await werk(p, "search", "sqlite");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Storage format");
  expect(r.stdout).toContain("decided");
  expect(r.stdout).toContain("Elsewhere");
  const u = await werk(p, "search", "sqlite", "--under", "parent");
  expect(lines(u.stdout)).toHaveLength(1);
  expect(u.stdout).toContain("Storage format");
  const s = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(s.stdout)).toHaveLength(1);
  expect(s.stdout).toContain("Storage format");
});

test("09.4 find the open work under one card", async () => {
  decided(p, "client", "Client");
  card(p, "routing", "Routing", { parent: "client" });
  card(p, "theme", "Theme", { parent: "client", status: "proto" });
  card(p, "guards", "Route guards", { parent: "routing" });
  decided(p, "pcard", "Postponed base", { parent: "client" });
  card(p, "paused", "Paused card", { parent: "client" });
  link(p, "paused", "pcard", "depends_on", "needs it");
  decided(p, "dcard", "Invalidated base");
  card(p, "stale", "Stale card", { parent: "client" });
  link(p, "stale", "dcard", "depends_on", "needs it");
  card(p, "opt", "An option", { kind: "option", why: "no" });
  link(p, "opt", "routing", "alternative_to");
  card(p, "src", "A source", { kind: "source" });
  link(p, "routing", "src", "supported_by");
  card(p, "billing", "Billing");
  ev(p, { type: "node.reopened", id: "pcard", reason: "postponed" });
  ev(p, { type: "node.reopened", id: "dcard", reason: "invalidated" });
  const a = await werk(p, "find", "routing");
  expect(a.code).toBe(0);
  const la = lines(a.stdout);
  expect(la[0]).toContain("Routing");
  expect(la[1]).toContain("Route guards");
  for (const t of ["Billing", "An option", "A source"]) expect(a.stdout).not.toContain(t);
  const b = await werk(p, "find", "client");
  const lb = lines(b.stdout);
  expect(lb.findIndex((l) => l.includes("Routing"))).toBeGreaterThanOrEqual(0);
  expect(lb.findIndex((l) => l.includes("Theme"))).toBeGreaterThanOrEqual(0);
  const guards = lb.findIndex((l) => l.includes("Route guards"));
  expect(lb.findIndex((l) => l.includes("Routing"))).toBeLessThan(guards);
  expect(lb.findIndex((l) => l.includes("Theme"))).toBeLessThan(guards);
  expect(b.stdout).not.toMatch(/\bclient\b.*\[decided\]/);
  for (const t of ["Paused card", "Stale card", "Postponed base"]) expect(b.stdout).not.toContain(t);
});

test("09.5 a card reopened as rejected is work in every tree", async () => {
  card(p, "t1", "Tree one");
  card(p, "t2", "Tree two");
  decided(p, "auth", "Auth flow");
  ev(p, { type: "node.reopened", id: "auth", reason: "rejected" });
  const r = await werk(p, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
