import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decided, ghost, open, seed, werkIn, lines, link, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
});
afterEach(() => p.dispose());

test("09.1 an agent lists the index of decided cards", async () => {
  seed(p, [
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    open("o1", { title: "Open one" }),
    // a ghost whose status is decided
    ghost("g1", { title: "Ghost one", status: "decided" }),
  ]);
  const r = await werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(out.some((l) => l.includes(id!) && l.includes(title!))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
  expect(p.events().length).toBeGreaterThan(0);
});

function cacheMap() {
  return [
    decided("cache-layout", { title: "Cache layout", body: "Cache eviction happens by the eviction policy." }),
    open("eviction-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", { title: "Cache size" }),
    decided("gone", { title: "Gone card", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  ];
}

test("09.2 two terms, best match first", async () => {
  seed(p, cacheMap());
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone card");
});

test("09.3 a word in a rejected option, and narrowing", async () => {
  seed(p, [
    decided("parent-topic", { title: "Parent topic" }),
    decided("storage-format", { title: "Storage format", parent: "parent-topic" }),
    open("storage-format:opt0", { kind: "option", title: "Use a database", why: "SQLite needs a native build" }),
    { type: "edge.added", from: "storage-format:opt0", to: "storage-format", link: "alternative_to", why: "weighed" },
    open("elsewhere", { title: "Elsewhere", body: "we might use sqlite here" }),
  ]);
  expect(p.events().length).toBeGreaterThan(0);
  const all = await werk("search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toMatch(/storage-format\s+\[decided\]/);
  expect(all.stdout).toContain("Elsewhere");
  const under = await werk("search", "sqlite", "--under", "parent-topic");
  expect(under.code).toBe(0);
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const status = await werk("search", "sqlite", "--status", "decided");
  expect(lines(status.stdout)).toHaveLength(1);
  expect(status.stdout).toContain("Storage format");
});

function clientMap() {
  return [
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("route-guards", { title: "Route guards", parent: "routing" }),
    open("routing:opt0", { kind: "option", title: "Routing option", why: "no" }),
    { type: "edge.added", from: "routing:opt0", to: "routing", link: "alternative_to", why: "w" },
    open("routing:src", { kind: "source", title: "Routing source" }),
    { type: "edge.added", from: "routing", to: "routing:src", link: "supported_by", why: "w" },
    open("billing", { title: "Billing" }),
    // postponed card
    decided("postponed-card", { title: "Postponed card", parent: "client" }),
    // paused: depends on a postponed origin
    decided("zed", { title: "Zed origin" }),
    decided("paused-card", { title: "Paused card", parent: "client" }),
    link("paused-card", "zed"),
    // stale: depends on a card reopened as invalidated
    decided("why-origin", { title: "Why origin" }),
    decided("stale-card", { title: "Stale card", parent: "client" }),
    link("stale-card", "why-origin"),
    { type: "node.reopened", id: "postponed-card", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "zed", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "why-origin", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  ];
}

test("09.4 find the open work under one card", async () => {
  seed(p, clientMap());
  const folded = await werk("show", "paused-card");
  expect(folded.stdout).toContain("PAUSED");
  expect((await werk("show", "stale-card")).stdout).toContain("STALE");
  expect((await werk("show", "postponed-card")).stdout).toContain("POSTPONED");
  const r = await werk("find", "routing");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("Routing");
  expect(out[1]).toContain("Route guards");
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("Routing option");
  expect(r.stdout).not.toContain("Routing source");
  const c = await werk("find", "client");
  const co = lines(c.stdout);
  expect(co.findIndex((l) => l.includes("Routing"))).toBeGreaterThanOrEqual(0);
  const iRouting = co.findIndex((l) => /^routing\s/.test(l));
  const iTheme = co.findIndex((l) => l.includes("Theme"));
  const iGuards = co.findIndex((l) => l.includes("Route guards"));
  expect(iRouting).toBeGreaterThanOrEqual(0);
  expect(iTheme).toBeGreaterThanOrEqual(0);
  expect(iGuards).toBeGreaterThan(iRouting);
  expect(iGuards).toBeGreaterThan(iTheme);
  expect(co.some((l) => /^client\s/.test(l))).toBe(false);
  expect(c.stdout).not.toContain("Paused card");
  expect(c.stdout).not.toContain("Stale card");
  expect(c.stdout).not.toContain("Postponed card");
});

test("09.5 a card reopened as rejected is work in every tree", async () => {
  seed(p, [
    decided("tree-a", { title: "Tree A" }),
    open("open-a", { title: "Open A", parent: "tree-a" }),
    decided("tree-b", { title: "Tree B" }),
    open("open-b", { title: "Open B", parent: "tree-b" }),
    decided("auth-flow", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth-flow", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  ]);
  const r = await werk("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Open A");
  expect(r.stdout).toContain("Open B");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toMatch(/\[decided\]/);
});
