import { afterEach, beforeEach, expect, test } from "bun:test";
import { accepted, createProject, type Project, realDecided, seed, werk } from "./h.ts";
import { decided, ghost, link, open, reopen } from "../src/map/mark-fixtures.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const lines = (s: string) => s.trim().split("\n").filter(Boolean);

test("09.1 index of decided cards", async () => {
  seed(
    p,
    decided("d1", { title: "Alpha" }),
    decided("d2", { title: "Beta" }),
    decided("d3", { title: "Gamma" }),
    open("o1", { title: "Open one" }),
    // a ghost whose status says decided
    ghost("g1", { title: "Ghost one", status: "decided" }),
  );
  const r = await werk(p, "search");
  const l = lines(r.stdout);
  expect(l.length).toBe(3);
  expect(r.stdout).toContain("d1  Alpha");
  expect(r.stdout).toContain("d2  Beta");
  expect(r.stdout).toContain("d3  Gamma");
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("g1");
});

test("09.2 two terms, best match first", async () => {
  seed(
    p,
    decided("cl", { title: "Cache layout", body: "Cache eviction\n\neviction policy" }),
    open("et", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cs", { title: "Cache size" }),
    open("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone", actor: "you" },
  );
  const r = await werk(p, "search", "cache", "eviction");
  const l = lines(r.stdout);
  expect(l.length).toBe(2);
  expect(l[0]).toMatch(/^cl\s+\[decided\]\s+Cache layout/);
  expect(l[1]).toMatch(/^et\s+\[open\]\s+Eviction timer/);
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 rejected option why-not, narrowing", async () => {
  seed(
    p,
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    open("storage:opt0", { kind: "option", title: "Use X", why: "SQLite needs a native build" }),
    link("storage:opt0", "storage", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "sqlite" }),
  );
  const a = await werk(p, "search", "sqlite");
  expect(a.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
  expect(a.stdout).toContain("Elsewhere");
  const b = await werk(p, "search", "sqlite", "--under", "parent");
  expect(lines(b.stdout).length).toBe(1);
  expect(b.stdout).toContain("Storage format");
  const c = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(c.stdout).length).toBe(1);
  expect(c.stdout).toContain("Storage format");
});

test("09.4 find the open work under one card", async () => {
  seed(
    p,
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // stale
    decided("d1"),
    open("stale1", { title: "Stale card", parent: "client" }),
    link("stale1", "d1"),
    reopen("d1", { reason: "invalidated" }),
    // paused
    decided("d2"),
    open("paused1", { title: "Paused card", parent: "client" }),
    link("paused1", "d2"),
    reopen("d2", { reason: "postponed" }),
    // postponed
    decided("post1", { title: "Postponed card", parent: "client" }),
    reopen("post1", { reason: "postponed" }),
    open("routing:opt0", { kind: "option", title: "Option X", why: "no" }),
    link("routing:opt0", "routing", "alternative_to"),
    open("routing:src", { kind: "source", title: "Source Y" }),
    link("routing", "routing:src", "supported_by"),
    open("billing", { title: "Billing" }),
  );
  const a = await werk(p, "find", "routing");
  const al = lines(a.stdout);
  expect(al[0]).toContain("routing");
  expect(al[1]).toContain("guards");
  expect(al.length).toBe(2);
  const b = await werk(p, "find", "client");
  const bl = lines(b.stdout);
  expect(bl.map((x) => x.split(/\s+/)[0])).toEqual(["routing", "theme", "guards"]);
  expect(b.stdout).not.toContain("Client\n");
  expect(b.stdout).not.toMatch(/stale1|paused1|post1|billing/);
});

test("09.5 a card reopened as rejected is work in every tree", async () => {
  seed(
    p,
    open("t1"),
    open("t2"),
    decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  );
  const r = await werk(p, "find");
  expect(r.stdout).toMatch(/^t1\s/m);
  expect(r.stdout).toMatch(/^t2\s/m);
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
