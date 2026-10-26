import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, edge, ghost, put, real, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const AT = "2026-10-10T09:00:00.000Z";
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists decided cards only", async () => {
  put(
    p,
    decided("d1", "Decided one"),
    decided("d2", "Decided two"),
    decided("d3", "Decided three"),
    real("o1", "Open one"),
    ghost("g1", "Ghost one", { status: "decided" }),
  );
  const r = await werk(p, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]])
    expect(out.some((l) => l.includes(id) && l.includes(t))).toBe(true);
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 search with two terms ranks by hits", async () => {
  put(
    p,
    decided("cache-layout", "Cache layout", { body: "Cache eviction is bounded. The eviction policy is LRU." }),
    real("evict-timer", "Eviction timer", { why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", "Cache size", { body: "cache only" }),
    real("gone", "Gone", { body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await werk(p, "search", "cache", "eviction");
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

test("09.3 search finds a word in a rejected option and narrows", async () => {
  put(
    p,
    decided("parent-topic", "Parent topic"),
    real("storage-format", "Storage format", { parent: "parent-topic" }),
    { type: "node.proposed", id: "opt", kind: "option", title: "Use the database", why: "SQLite needs a native build", status: "open" },
    { type: "node.accepted", id: "opt", actor: "you" },
    edge("opt", "storage-format", "alternative_to"),
    { type: "node.edited", id: "storage-format", who: "me", noBasis: "t" },
    { type: "criterion.added", id: "storage-format", form: "revisit" },
    { type: "node.decided", id: "storage-format" },
    real("elsewhere", "Elsewhere", { body: "we could use sqlite here" }),
  );
  const a = await werk(p, "search", "sqlite");
  expect(a.code).toBe(0);
  expect(a.stdout).toMatch(/storage-format.*decided/);
  expect(a.stdout).toContain("elsewhere");
  const b = await werk(p, "search", "sqlite", "--under", "parent-topic");
  expect(lines(b.stdout)).toHaveLength(1);
  expect(b.stdout).toContain("storage-format");
  const c = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(c.stdout)).toHaveLength(1);
  expect(c.stdout).toContain("storage-format");
});

test("09.4 find lists open work under one card", async () => {
  put(
    p,
    decided("client", "Client"),
    decided("base", "Base"),
    decided("pq", "Postponed card", { parent: "client" }),
    real("routing", "Routing", { parent: "client" }),
    real("theme", "Theme", { parent: "client", status: "proto" }),
    real("route-guards", "Route guards", { parent: "routing" }),
    real("paused-card", "Paused card", { parent: "client" }),
    real("stale-card", "Stale card", { parent: "client" }),
    edge("paused-card", "pq", "depends_on"),
    edge("stale-card", "base", "depends_on"),
    { type: "node.reopened", id: "pq", reason: "postponed", at: AT },
    { type: "node.reopened", id: "base", reason: "invalidated", at: AT },
    { type: "node.proposed", id: "routing:opt", kind: "option", title: "Opt", status: "open" },
    { type: "node.accepted", id: "routing:opt", actor: "you" },
    edge("routing:opt", "routing", "alternative_to"),
    { type: "node.proposed", id: "routing:src", kind: "source", title: "Src", status: "open" },
    { type: "node.accepted", id: "routing:src", actor: "you" },
    edge("routing", "routing:src", "supported_by"),
    real("billing", "Billing"),
  );
  const a = await werk(p, "find", "routing");
  expect(a.code).toBe(0);
  const la = lines(a.stdout);
  expect(la[0]).toContain("routing");
  expect(la[1]).toContain("route-guards");
  expect(a.stdout).not.toContain("Billing");
  expect(a.stdout).not.toContain("routing:opt");
  expect(a.stdout).not.toContain("routing:src");
  const b = await werk(p, "find", "client");
  const lb = lines(b.stdout);
  expect(b.stdout).toContain("routing");
  expect(b.stdout).toContain("theme");
  expect(b.stdout.indexOf("route-guards")).toBeGreaterThan(b.stdout.indexOf("theme"));
  expect(lb.some((l) => /^client\b/.test(l))).toBe(false);
  expect(b.stdout).not.toContain("paused-card");
  expect(b.stdout).not.toContain("stale-card");
  expect(b.stdout).not.toContain("Postponed card");
});

test("09.5 a card reopened as rejected comes back as work", async () => {
  put(
    p,
    real("tree-a", "Tree A"),
    real("tree-b", "Tree B"),
    decided("auth-flow", "Auth flow"),
    { type: "node.reopened", id: "auth-flow", reason: "rejected", at: AT },
  );
  const r = await werk(p, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("tree-a");
  expect(r.stdout).toContain("tree-b");
  expect(r.stdout).toContain("auth-flow");
  expect(r.stdout).not.toContain("[decided]");
});
