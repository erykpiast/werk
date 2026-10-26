import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, ghost, link, open, reopen, seed, werk } from "./g2-util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const lines = (s: string) => s.split("\n").filter((l) => l !== "");

test("09.1 search with no term lists the decided cards only", async () => {
  seed(p, [
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    open("o1", { title: "Open one" }),
    // a ghost decided before it became a ghost: decided without accept
    ghost("g1", { title: "Ghost one" }),
    { type: "node.edited", id: "g1", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "g1", form: "revisit" },
    { type: "node.decided", id: "g1" },
  ]);
  const r = await werk(p, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(out.some((l) => l.includes(id) && l.includes(t))).toBe(true);
  }
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("g1");
});

test("09.2 two terms, best match first", async () => {
  seed(p, [
    decided("layout", { title: "Cache layout", body: "Cache eviction and eviction policy" }),
    open("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("size", { title: "Cache size", why: "cache sizing" }),
    decided("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone", actor: "you" },
  ]);
  const r = await werk(p, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 rejected option word, --under, --status", async () => {
  seed(p, [
    decided("parent", { title: "Parent topic" }),
    ...decided("storage", { title: "Storage format", parent: "parent" }).slice(0, 0),
    decided("storage", { title: "Storage format", parent: "parent" }),
    open("opt", { kind: "option", title: "Use sqlite", why: "SQLite needs a native build" }),
    link("opt", "storage", "alternative_to", "weighed"),
    open("other", { title: "Other open", body: "we could use sqlite" }),
  ]);
  const all = await werk(p, "search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("storage");
  expect(all.stdout).toContain("[decided]");
  expect(all.stdout).toContain("other");
  const under = await werk(p, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("storage");
  const st = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(st.stdout)).toHaveLength(1);
  expect(st.stdout).toContain("storage");
});

function clientTree() {
  return [
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // postponed: decided then reopened as postponed
    decided("post", { title: "Postponed card", parent: "client" }),
    // paused: depends on the postponed card (the link exists before the reopen)
    open("paused", { title: "Paused card", parent: "client" }),
    link("paused", "post"),
    reopen("post", "postponed"),
    // stale: depends on a decided card that is then invalidated
    decided("base", { title: "Base" }),
    open("stale", { title: "Stale card", parent: "client" }),
    link("stale", "base"),
    reopen("base", "invalidated"),
    open("opt", { kind: "option", title: "An option", parent: "routing" }),
    open("src", { kind: "source", title: "A source", parent: "routing" }),
    open("billing", { title: "Billing" }),
  ];
}

test("09.4 find lists open work under a card", async () => {
  seed(p, clientTree());
  const r1 = await werk(p, "find", "routing");
  expect(r1.code).toBe(0);
  const o1 = lines(r1.stdout);
  expect(o1[0]).toContain("Routing");
  expect(o1[1]).toContain("Route guards");
  for (const t of ["Billing", "An option", "A source"]) expect(r1.stdout).not.toContain(t);
  const r2 = await werk(p, "find", "client");
  const o2 = r2.stdout;
  expect(o2).toContain("Routing");
  expect(o2).toContain("Theme");
  expect(o2.indexOf("Routing")).toBeLessThan(o2.indexOf("Route guards"));
  expect(o2.indexOf("Theme")).toBeLessThan(o2.indexOf("Route guards"));
  expect(o2).not.toContain("[decided]");
  expect(o2).not.toContain("  Client");
  for (const t of ["Paused card", "Stale card", "Postponed card"]) expect(o2).not.toContain(t);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(p, [
    open("t1", { title: "Tree one" }),
    open("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    reopen("auth", "rejected"),
  ]);
  const r = await werk(p, "find");
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
