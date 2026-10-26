import { afterEach, beforeEach, expect, test } from "bun:test";
import { readMap } from "../src/map/log-store.ts";
import { createProject, dec, link, opn, type Project, runner, seed } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const lines = (s: string) => s.split("\n").filter((l) => l !== "");
const at = "2026-10-10T09:00:00.000Z";

test("09.1 search with no term lists the decided cards only", async () => {
  const w = runner(project);
  seed(project,
    dec("a", undefined, { title: "Alpha" }), dec("b", undefined, { title: "Bravo" }), dec("c", undefined, { title: "Charlie" }),
    opn("o", undefined, { title: "Open one" }),
    // a ghost that carries the decided status
    { type: "node.proposed", id: "g", kind: "card", title: "Ghost one", status: "decided" });
  const map = readMap(project.logPath).map;
  const r = await w("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["a", "Alpha"], ["b", "Bravo"], ["c", "Charlie"]]) {
    expect(out.some((l) => l.includes(id) && l.includes(title))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
  void map;
});

test("09.2 search with two terms ranks by hits", async () => {
  const w = runner(project);
  seed(project,
    dec("cache-layout", undefined, { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    opn("evict-timer", undefined, { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    dec("cache-size", undefined, { title: "Cache size", body: "cache only" }),
    opn("gone", undefined, { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone" });
  const r = await w("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("evict-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 a word in a rejected option and the narrowing flags", async () => {
  const w = runner(project);
  seed(project,
    dec("parent-topic", undefined, { title: "Parent topic" }),
    dec("storage-format", "parent-topic", { title: "Storage format" }),
    { type: "node.proposed", id: "storage-format:opt0", kind: "option", title: "Use a database", why: "SQLite needs a native build", status: "open" },
    { type: "node.accepted", id: "storage-format:opt0", actor: "you" },
    link("storage-format:opt0", "storage-format", "alternative_to"),
    opn("elsewhere", undefined, { title: "Elsewhere", body: "we may use sqlite" }));
  const all = await w("search", "sqlite");
  expect(all.stdout).toContain("storage-format");
  expect(all.stdout).toMatch(/storage-format.*decided/);
  expect(all.stdout).toContain("elsewhere");
  const under = await w("search", "sqlite", "--under", "parent-topic");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("storage-format");
  const dcd = await w("search", "sqlite", "--status", "decided");
  expect(lines(dcd.stdout)).toHaveLength(1);
  expect(dcd.stdout).toContain("storage-format");
});

function clientMap() {
  const rs = (id: string, extra: Record<string, unknown>) => ({ type: "node.reopened", id, at, ...extra });
  seed(project,
    dec("client", undefined, { title: "Client" }),
    opn("routing", "client", { title: "Routing" }),
    { type: "node.proposed", id: "theme", kind: "card", title: "Theme", status: "proto", parent: "client" },
    { type: "node.accepted", id: "theme", actor: "you" },
    opn("route-guards", "routing", { title: "Route guards" }),
    // paused: depends on a card that is postponed
    dec("upstream", undefined, { title: "Upstream" }),
    opn("paused-card", "client", { title: "Paused card" }),
    link("paused-card", "upstream", "depends_on"),
    rs("upstream", { reason: "postponed" }),
    // stale: depends on a decided card that is then invalidated
    dec("basis", undefined, { title: "Basis" }),
    opn("stale-card", "client", { title: "Stale card" }),
    link("stale-card", "basis", "depends_on"),
    rs("basis", { reason: "invalidated" }),
    // postponed itself
    dec("post-card", "client", { title: "Postponed card" }),
    rs("post-card", { reason: "postponed" }),
    { type: "node.proposed", id: "routing:opt0", kind: "option", title: "An option", why: "no", status: "open" },
    { type: "node.accepted", id: "routing:opt0", actor: "you" },
    link("routing:opt0", "routing", "alternative_to"),
    { type: "node.proposed", id: "routing:src", kind: "source", title: "A source", status: "open" },
    { type: "node.accepted", id: "routing:src", actor: "you" },
    link("routing", "routing:src", "supported_by"),
    opn("billing", undefined, { title: "Billing" }));
}

test("09.4 find lists the open work under one card", async () => {
  const w = runner(project);
  clientMap();
  const map = readMap(project.logPath).map;
  expect(map.problems).toEqual([]);
  const r = await w("find", "routing");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out[0]).toContain("routing");
  expect(out[1]).toContain("route-guards");
  for (const x of ["billing", "An option", "A source"]) expect(r.stdout).not.toContain(x);
  const c = await w("find", "client");
  const co = lines(c.stdout);
  const idx = (s: string) => co.findIndex((l) => l.includes(s));
  expect(idx("routing")).toBeGreaterThanOrEqual(0);
  expect(idx("theme")).toBeGreaterThanOrEqual(0);
  expect(idx("route-guards")).toBeGreaterThan(Math.max(idx("routing"), idx("theme")));
  expect(c.stdout).not.toMatch(/^client\b/m);
  for (const x of ["paused-card", "stale-card", "post-card"]) expect(c.stdout).not.toContain(x);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const w = runner(project);
  seed(project, opn("tree-a", undefined, { title: "Tree A" }), opn("tree-b", undefined, { title: "Tree B" }),
    dec("auth-flow", undefined, { title: "Auth flow" }),
    { type: "node.reopened", id: "auth-flow", at, reason: "rejected" });
  const r = await w("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("tree-a");
  expect(r.stdout).toContain("tree-b");
  expect(r.stdout).toContain("auth-flow");
  expect(r.stdout).not.toContain("[decided]");
});
