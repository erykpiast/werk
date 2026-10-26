import { expect, test } from "bun:test";
import { proj } from "./c-lib.ts";

test("09.1 index lists decided cards only", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("d1", { title: "Decided one", parent: "root" }, true);
  p.card("d2", { title: "Decided two", parent: "root" }, true);
  p.card("d3", { title: "Decided three", parent: "root" }, true);
  p.card("o1", { title: "Open one", parent: "root" });
  p.seed("node.proposed", { id: "g1", kind: "card", title: "Ghost one", parent: "root" });
  p.seed("node.decided", { id: "g1" });
  const r = p.werk("search");
  expect(r.code).toBe(0);
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) expect(r.out).toContain(`${id}  ${t}`);
  expect(r.out).not.toContain("Open one");
  expect(r.out).not.toContain("Ghost one");
});

test("09.2 two terms, best match first", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("cache-layout", { title: "Cache layout", body: "Cache eviction\n\neviction policy", parent: "root" }, true);
  p.card("evict-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup", parent: "root" });
  p.card("cache-size", { title: "Cache size", parent: "root" }, true);
  p.card("gone", { title: "cache eviction gone", parent: "root" }, true);
  p.seed("node.removed", { id: "gone" });
  const r = p.werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("evict-timer");
  expect(lines[1]).toContain("open");
  expect(lines[1]).toContain("Eviction timer");
  expect(r.out).not.toContain("cache-size");
  expect(r.out).not.toContain("gone");
});

test("09.3 rejected option word, under and status", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("parent-topic", { title: "Parent topic", parent: "root" }, true);
  p.card("storage-format", { title: "Storage format", parent: "parent-topic" }, true);
  p.seed("node.added", { id: "storage-format:opt0", kind: "option", title: "Use a db", why_not: "SQLite needs a native build" });
  p.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  p.card("other-open", { title: "Other open", body: "we could use sqlite here", parent: "root" });
  const r = p.werk("search", "sqlite");
  expect(r.out).toContain("storage-format");
  expect(r.out).toContain("decided");
  expect(r.out).toContain("other-open");
  const u = p.werk("search", "sqlite", "--under", "parent-topic");
  expect(u.out).toContain("storage-format");
  expect(u.out).not.toContain("other-open");
  expect(u.out.trim().split("\n").length).toBe(1);
  const s = p.werk("search", "sqlite", "--status", "decided");
  expect(s.out).toContain("storage-format");
  expect(s.out).not.toContain("other-open");
});

test("09.4 find the open work under one card", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("client", { title: "Client", parent: "root" }, true);
  p.card("routing", { title: "Routing", parent: "client" });
  p.card("theme", { title: "Theme", parent: "client", status: "proto" });
  p.card("guards", { title: "Route guards", parent: "routing" });
  p.card("paused-c", { title: "Paused card", parent: "client" });
  p.card("stale-c", { title: "Stale card", parent: "client" });
  p.card("postponed-c", { title: "Postponed card", parent: "client" });
  // marks: a decided base card reopened postponed pauses its dependents; rejected makes the next hop stale
  p.card("base-p", { title: "Base P", parent: "root" }, true);
  p.card("base-r", { title: "Base R", parent: "root" }, true);
  p.seed("edge.added", { from: "paused-c", to: "base-p", type: "depends_on", why: "needs" });
  p.seed("edge.added", { from: "stale-c", to: "base-r", type: "depends_on", why: "needs" });
  p.seed("node.reopened", { id: "base-p", reason: "postponed", why: "later" });
  p.seed("node.reopened", { id: "base-r", reason: "rejected", why: "wrong" });
  p.seed("node.decided", { id: "postponed-c" });
  p.seed("node.reopened", { id: "postponed-c", reason: "postponed", why: "later" });
  p.seed("node.added", { id: "routing:opt0", kind: "option", title: "OptionX", why_not: "no" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.seed("node.added", { id: "routing-src", kind: "source", title: "SourceX" });
  p.seed("edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  p.card("billing", { title: "Billing" , parent: "root" });
  const r = p.werk("find", "routing");
  const ids = r.out.trim().split("\n").map((l) => l.split(/\s+/)[0]);
  expect(ids).toEqual(["routing", "guards"]);
  expect(r.out).not.toContain("Billing");
  expect(r.out).not.toContain("OptionX");
  expect(r.out).not.toContain("SourceX");
  const c = p.werk("find", "client");
  const cids = c.out.trim().split("\n").map((l) => l.split(/\s+/)[0]);
  expect(cids.slice(0, 2).sort()).toEqual(["routing", "theme"]);
  expect(cids.indexOf("guards")).toBeGreaterThan(1);
  expect(cids).not.toContain("client");
  for (const x of ["paused-c", "stale-c", "postponed-c"]) expect(cids).not.toContain(x);
});

test("09.5 a card reopened as rejected is work in find with no id", () => {
  const p = proj();
  p.card("root", { title: "Root" });
  p.card("a-open", { title: "Open A", parent: "root" });
  p.card("root2", { title: "Root two" });
  p.card("b-open", { title: "Open B", parent: "root2" });
  p.card("auth", { title: "Auth flow", parent: "root" }, true);
  p.seed("node.reopened", { id: "auth", reason: "rejected", why: "bad" });
  const r = p.werk("find");
  expect(r.code).toBe(0);
  expect(r.out).toContain("a-open");
  expect(r.out).toContain("b-open");
  expect(r.out).toContain("auth");
  expect(r.out).not.toContain("decided");
});
