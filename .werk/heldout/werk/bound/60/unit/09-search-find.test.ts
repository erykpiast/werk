import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, link, open, reopen } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { lines, werk, writeLog } from "./09-11-lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

test("09.1 search with no term lists the decided cards only", async () => {
  writeLog(project, [
    ...decided("d1", { title: "First decided" }),
    ...decided("d2", { title: "Second decided" }),
    ...decided("d3", { title: "Third decided" }),
    ...open("o1", { title: "An open card" }),
    ghost("gh", { title: "Ghost card", status: "decided" }),
  ]);
  const r = await werk(project, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "First decided"],
    ["d2", "Second decided"],
    ["d3", "Third decided"],
  ]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("An open card");
  expect(r.stdout).not.toContain("Ghost card");
});

test("09.2 search with two terms ranks by hits and skips removed and non-matching cards", async () => {
  writeLog(project, [
    ...decided("layout", {
      title: "Cache layout",
      body: "Cache eviction happens here. The eviction policy is LRU.",
    }),
    ...open("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    ...decided("size", { title: "Cache size", body: "how big" }),
    ...open("gone", { title: "Removed one", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  ]);
  const r = await werk(project, "search", "cache", "eviction");
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
  expect(r.stdout).not.toContain("Removed one");
});

test("09.3 search finds a card by the why-not of its option, and narrows by --under and --status", async () => {
  writeLog(project, [
    ...decided("parent", { title: "Parent topic" }),
    ...decided("storage", { title: "Storage format", parent: "parent" }),
    ...open("opt", { kind: "option", title: "Use SQLite", why: "SQLite needs a native build" }),
    link("opt", "storage", "alternative_to"),
    ...open("elsewhere", { title: "Elsewhere", body: "we could try sqlite later" }),
  ]);
  // The fixture must hold the premise: no title, why or body names sqlite on the card itself.
  const all = await werk(project, "search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toMatch(/storage.*decided.*Storage format/);
  expect(all.stdout).toContain("Elsewhere");

  const under = await werk(project, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");

  const status = await werk(project, "search", "sqlite", "--status", "decided");
  expect(lines(status.stdout)).toHaveLength(1);
  expect(status.stdout).toContain("Storage format");
});

test("09.4 find lists open work under one card, breadth first, with no waiting cards", async () => {
  writeLog(project, [
    ...decided("other", { title: "Other tree" }),
    ...decided("client", { title: "Client" }),
    ...open("routing", { title: "Routing", parent: "client" }),
    ...open("theme", { title: "Theme", parent: "client", status: "proto" }),
    ...open("guards", { title: "Route guards", parent: "routing" }),
    ...open("billing", { title: "Billing" }),
    // an open card with a postponed mark, one paused by it, one stale
    ...decided("pp", { title: "Postponed one", parent: "client" }),
    ...open("paused", { title: "Paused one", parent: "client" }),
    link("paused", "pp"),
    reopen("pp", { reason: "postponed", why: "later" }),
    ...open("stl", { title: "Stale one", parent: "client" }),
    link("stl", "other"),
    reopen("other", { reason: "invalidated" }),
    // an option and a source attached to routing
    ...open("opt", { kind: "option", title: "Routing option", why: "no" }),
    link("opt", "routing", "alternative_to"),
    ...open("src", { kind: "source", title: "Routing source", why: "found" }),
    link("routing", "src", "supported_by"),
  ]);
  // The premise: the three cards carry their marks.
  expect((await werk(project, "show", "paused")).stdout).toContain("PAUSED");
  expect((await werk(project, "show", "stl")).stdout).toContain("STALE");
  expect((await werk(project, "show", "pp")).stdout).toContain("POSTPONED");
  const r1 = await werk(project, "find", "routing");
  expect(r1.code).toBe(0);
  const o1 = lines(r1.stdout);
  expect(o1).toHaveLength(2);
  expect(o1[0]).toContain("Routing");
  expect(o1[1]).toContain("Route guards");
  for (const t of ["Billing", "Routing option", "Routing source"])
    expect(r1.stdout).not.toContain(t);

  const r2 = await werk(project, "find", "client");
  expect(r2.code).toBe(0);
  const o2 = lines(r2.stdout);
  const at = (t: string) => o2.findIndex((l) => l.includes(t));
  expect(at("Routing")).toBeGreaterThanOrEqual(0);
  expect(at("Theme")).toBeGreaterThanOrEqual(0);
  expect(at("Route guards")).toBeGreaterThan(at("Routing"));
  expect(at("Route guards")).toBeGreaterThan(at("Theme"));
  expect(o2.some((l) => l.includes("client") && l.includes("Client"))).toBe(false);
  for (const t of ["Postponed one", "Paused one", "Stale one"])
    expect(r2.stdout).not.toContain(t);
});

test("09.5 find with no id lists the open card of each tree and a rejected card, no decided card", async () => {
  writeLog(project, [
    ...decided("t1", { title: "Tree one" }),
    ...open("o1", { title: "Open one", parent: "t1" }),
    ...decided("t2", { title: "Tree two" }),
    ...open("o2", { title: "Open two", parent: "t2" }),
    ...decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected", why: "no" }),
  ]);
  const r = await werk(project, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Open one");
  expect(r.stdout).toContain("Open two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
