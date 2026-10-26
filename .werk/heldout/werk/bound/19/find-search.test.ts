import { afterEach, beforeEach, expect, test } from "bun:test";
import { type World, child, decided, decidedChild, ghost, link, open, reopen, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const ids = (out: string) => out.split("\n").filter(Boolean).map((l) => l.trim().split(/\s+/)[0]);

test("09.1 search with no term lists decided cards only, no open card, no ghost", async () => {
  w.seed(
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    open("o1", { title: "Open one" }),
    // a ghost that carries the decided status
    decided("g1", { title: "Ghost decided" }).filter((e: any) => e.type !== "node.accepted"),
  );
  expect((await w.werk("show", "g1")).stdout).toMatch(/\[decided\]\s+proposed/);
  const r = await w.werk("search");
  expect(r.code, r.stderr).toBe(0);
  const lines = r.stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(3);
  expect(r.stdout).toContain("d1");
  expect(r.stdout).toContain("Decided one");
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("g1");
});

test("09.2 two terms, best match first; open card included; removed and partial excluded", async () => {
  w.seed(
    decided("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    open("evict-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", { title: "Cache size", body: "cache" }),
    decided("gone", { title: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await w.werk("search", "cache", "eviction");
  expect(r.code, r.stderr).toBe(0);
  const lines = r.stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("evict-timer");
  expect(lines[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("gone");
});

test("09.3 a word in a rejected option's why-not finds the card; --under and --status narrow", async () => {
  w.seed(
    decided("parent", { title: "Parent topic" }),
    decidedChild("storage", "parent", { title: "Storage format" }),
    open("storage:opt0", { kind: "option", title: "SQLite file", why: "SQLite needs a native build" }),
    link("storage:opt0", "storage", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "we might use sqlite here" }),
  );
  const all = await w.werk("search", "sqlite");
  expect(all.code, all.stderr).toBe(0);
  expect(all.stdout).toMatch(/storage\s+\[decided\]/);
  expect(all.stdout).toContain("elsewhere");
  const under = await w.werk("search", "sqlite", "--under", "parent");
  expect(ids(under.stdout)).toEqual(["storage"]);
  const st = await w.werk("search", "sqlite", "--status", "decided");
  expect(ids(st.stdout)).toEqual(["storage"]);
});

function workTree() {
  w.seed(
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    open("routing:opt0", { kind: "option", title: "Option", why: "no" }),
    link("routing:opt0", "routing", "alternative_to"),
    open("routing:src", { kind: "source", title: "A source" }),
    link("routing", "routing:src", "supported_by"),
    open("billing", { title: "Billing" }),
    // a paused card: depends on a card that gets postponed
    decidedChild("post", "client", { title: "Postponed card" }),
    open("paused", { title: "Paused card", parent: "client" }),
    link("paused", "post", "depends_on"),
    // a stale card: depends on a card that is reopened as invalidated
    decided("base", { title: "Base" }),
    open("stale", { title: "Stale card", parent: "client" }),
    link("stale", "base", "depends_on"),
    reopen("base", { reason: "invalidated" }),
    reopen("post", { reason: "postponed" }),
  );
}

test("09.4 find under a card lists its open work, breadth first, with no marked card", async () => {
  workTree();
  expect((await w.werk("show", "paused")).stdout).toContain("PAUSED");
  expect((await w.werk("show", "stale")).stdout).toContain("STALE");
  expect((await w.werk("show", "post")).stdout).toContain("POSTPONED");
  const r = await w.werk("find", "routing");
  expect(r.code, r.stderr).toBe(0);
  expect(ids(r.stdout)).toEqual(["routing", "guards"]);
  const c = await w.werk("find", "client");
  expect(c.code, c.stderr).toBe(0);
  const list = ids(c.stdout);
  expect(list.indexOf("routing")).toBeLessThan(list.indexOf("guards"));
  expect(list.indexOf("theme")).toBeLessThan(list.indexOf("guards"));
  expect(list).not.toContain("client");
  for (const hidden of ["paused", "stale", "post"]) expect(list).not.toContain(hidden);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  w.seed(
    open("t1", { title: "Tree one" }),
    open("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  );
  const r = await w.werk("find");
  expect(r.code, r.stderr).toBe(0);
  const list = ids(r.stdout);
  expect(list).toContain("t1");
  expect(list).toContain("t2");
  expect(list).toContain("auth");
  expect(r.stdout).not.toContain("[decided]");
});
