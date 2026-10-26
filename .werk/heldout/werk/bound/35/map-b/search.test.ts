import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  build,
  decided,
  ghost,
  link,
  open,
  reopen,
} from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { seedMap, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const run = (...a: string[]) => werk(project, ...a);
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists the decided cards only", async () => {
  seedMap(
    project,
    decided("d1", { title: "First" }),
    decided("d2", { title: "Second" }),
    decided("d3", { title: "Third" }),
    open("o1", { title: "Open one" }),
    // a ghost that carries the decided status
    ghost("gh", { title: "Ghost one", status: "decided" }),
  );
  const r = await run("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  expect(r.stdout).toContain("d1");
  expect(r.stdout).toContain("First");
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 two terms: best match first, others left out", async () => {
  seedMap(
    project,
    decided("cl", {
      title: "Cache layout",
      body: "Cache eviction and the eviction policy",
    }),
    open("et", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("cs", { title: "Cache size", why: "cache" }),
    decided("rm", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "rm" },
  );
  const r = await run("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cl");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("Eviction timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 a word in a rejected option's why-not finds the card; --under and --status narrow", async () => {
  seedMap(
    project,
    decided("parent", { title: "Parent topic" }),
    decided("store", {
      title: "Storage format",
      parent: "parent",
      who: undefined,
    }),
    open("store:opt0", {
      kind: "option",
      title: "Use a database",
      why: "SQLite needs a native build",
    }),
    link("store:opt0", "store", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "sqlite is mentioned" }),
  );
  const all = await run("search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toMatch(/store\s+\[decided\]/);
  expect(all.stdout).toContain("Elsewhere");
  const under = await run("search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const st = await run("search", "sqlite", "--status", "decided");
  expect(lines(st.stdout)).toHaveLength(1);
  expect(st.stdout).toContain("Storage format");
});

test("09.4 find lists open work under one card", async () => {
  seedMap(
    project,
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // paused: depends on a card that is postponed
    decided("q", { title: "Q" }),
    open("paused", { title: "Paused card", parent: "client" }),
    link("paused", "q"),
    // stale: depends on a card whose decision was invalidated
    decided("x", { title: "X" }),
    open("stale", { title: "Stale card", parent: "client" }),
    link("stale", "x"),
    // postponed itself
    decided("post", { title: "Postponed card", parent: "client" }),
    open("routing:opt0", { kind: "option", title: "An option", why: "w" }),
    link("routing:opt0", "routing", "alternative_to"),
    open("routing:src", { kind: "source", title: "A source", why: "f" }),
    link("routing", "routing:src", "supported_by"),
    open("billing", { title: "Billing" }),
    reopen("q", { reason: "postponed" }),
    reopen("x", { reason: "invalidated" }),
    reopen("post", { reason: "postponed" }),
  );
  const a = await run("find", "routing");
  expect(a.code).toBe(0);
  const l = lines(a.stdout);
  expect(l[0]).toContain("Routing");
  expect(l[1]).toContain("Route guards");
  for (const w of ["Billing", "An option", "A source"]) {
    expect(a.stdout).not.toContain(w);
  }
  const b = await run("find", "client");
  expect(b.code).toBe(0);
  const i = (s: string) => b.stdout.indexOf(s);
  expect(i("Routing")).toBeGreaterThan(-1);
  expect(i("Theme")).toBeGreaterThan(-1);
  expect(i("Routing")).toBeLessThan(i("Route guards"));
  expect(i("Theme")).toBeLessThan(i("Route guards"));
  expect(lines(b.stdout).some((x) => /\bclient\b\s+\[/.test(x))).toBe(false);
  for (const w of ["Paused card", "Stale card", "Postponed card"]) {
    expect(b.stdout).not.toContain(w);
  }
});

test("09.5 a decided card reopened as rejected shows in find with no id", async () => {
  seedMap(
    project,
    open("t1", { title: "Tree one" }),
    open("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  );
  const r = await run("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
