import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decidedEvents, ghost, linkEvent, openEvents, type Project, seed, werk } from "./support.ts";
import { reopen } from "../src/map/mark-fixtures.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const T = (id: string, extra: Record<string, unknown> = {}) => ({ title: `T ${id}`, ...extra });
const lines = (out: string) => out.split("\n").filter(Boolean);

test("09.1 search with no term lists the index of decided cards", async () => {
  seed(p, decidedEvents("d1", T("d1")), decidedEvents("d2", T("d2")), decidedEvents("d3", T("d3")), openEvents("o1", T("o1")), decidedEvents("g1", T("g1")));
  // a card that was decided and then became a ghost: a proposed change leaves it a decided card, so use a ghost with status decided
  seed(p, ghost("gh", { title: "T gh", status: "decided" }));
  const r = await werk(p, "search");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  for (const id of ["d1", "d2", "d3"]) expect(out.some((l) => l.includes(id) && l.includes(`T ${id}`))).toBe(true);
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("T gh");
});

test("09.2 two terms, best match first", async () => {
  seed(
    p,
    decidedEvents("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    openEvents("eviction-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decidedEvents("cache-size", { title: "Cache size" }),
    decidedEvents("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await werk(p, "search", "cache", "eviction");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("cache-size");
  expect(r.stdout).not.toContain("gone");
});

test("09.3 a word in a rejected option, narrowed", async () => {
  seed(
    p,
    decidedEvents("parent", { title: "Parent topic" }),
    decidedEvents("storage-format", { title: "Storage format", parent: "parent" }),
    openEvents("storage-format:opt0", { kind: "option", title: "Use a database", why: "SQLite needs a native build" }),
    linkEvent("storage-format:opt0", "storage-format", "alternative_to"),
    openEvents("outside", { title: "Outside", body: "we may use sqlite here" }),
  );
  const all = await werk(p, "search", "sqlite");
  expect(all.code, all.stderr).toBe(0);
  expect(all.stdout).toContain("storage-format");
  expect(all.stdout).toMatch(/storage-format.*decided/);
  expect(all.stdout).toContain("outside");
  const under = await werk(p, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("storage-format");
  const dec = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(dec.stdout)).toHaveLength(1);
  expect(dec.stdout).toContain("storage-format");
});

test("09.4 find the open work under one card", async () => {
  seed(
    p,
    decidedEvents("top"),
    decidedEvents("other", { parent: "top" }),
    decidedEvents("client", { parent: "top" }),
    openEvents("routing", { parent: "client", title: "Routing" }),
    openEvents("theme", { parent: "client", title: "Theme", status: "proto" }),
    openEvents("route-guards", { parent: "routing", title: "Route guards" }),
    openEvents("routing:opt0", { kind: "option", title: "An option" }),
    linkEvent("routing:opt0", "routing", "alternative_to"),
    openEvents("src1", { kind: "source", title: "A source" }),
    linkEvent("routing", "src1", "supported_by"),
    decidedEvents("postp", { parent: "client" }),
    openEvents("paused-card", { parent: "client", title: "Paused card" }),
    linkEvent("paused-card", "postp"),
    reopen("postp", { reason: "postponed" }),
    decidedEvents("orig", { parent: "other" }),
    openEvents("stale-card", { parent: "client", title: "Stale card" }),
    linkEvent("stale-card", "orig"),
    reopen("orig"),
    openEvents("billing", { title: "Billing" }),
  );
  const r = await werk(p, "find", "routing");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out[0]).toContain("routing");
  expect(out[1]).toContain("route-guards");
  for (const x of ["billing", "An option", "A source"]) expect(r.stdout).not.toContain(x);
  const c = await werk(p, "find", "client");
  const ids = lines(c.stdout).map((l) => l.split(/\s+/)[0]);
  expect(ids.indexOf("routing")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids.indexOf("theme")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids).not.toContain("client");
  for (const x of ["paused-card", "stale-card", "postp"]) expect(ids).not.toContain(x);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(p, openEvents("a", { title: "A" }), openEvents("b", { title: "B" }), decidedEvents("auth-flow", { title: "Auth flow" }), reopen("auth-flow", { reason: "rejected" }));
  const r = await werk(p, "find");
  expect(r.code, r.stderr).toBe(0);
  const ids = lines(r.stdout).map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("a");
  expect(ids).toContain("b");
  expect(ids).toContain("auth-flow");
  expect(r.stdout).not.toMatch(/\[decided\]/);
});
