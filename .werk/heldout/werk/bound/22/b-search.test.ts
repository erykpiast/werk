import { afterEach, expect, test } from "bun:test";
import { cleanupAll, type P, project } from "./cli.ts";

afterEach(cleanupAll);

const rows = (out: string) => out.split("\n").filter((l) => l.trim() !== "");
const ids = (p: P, ...args: string[]) => rows(p.werk(...args).out).map((l) => l.split(/\s+/)[0]);

test("09.1 search with no term lists decided cards only", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("d1", "First decided", { parent: "root", status: "decided" });
  p.card("d2", "Second decided", { parent: "root", status: "decided" });
  p.card("o1", "Open card", { parent: "root" });
  p.seed("node.proposed", { id: "g1", kind: "card", title: "Ghost card", parent: "root", status: "decided" }, "agent");
  const r = p.werk("search");
  expect(r.code).toBe(0);
  const lines = rows(r.out);
  // Three decided cards: root, d1, d2.
  expect(lines.length).toBe(3);
  expect(lines).toContainEqual(expect.stringMatching(/^root\s+Root$/));
  expect(lines).toContainEqual(expect.stringMatching(/^d1\s+First decided$/));
  expect(lines).toContainEqual(expect.stringMatching(/^d2\s+Second decided$/));
  expect(r.out).not.toContain("o1");
  expect(r.out).not.toContain("g1");
});

test("09.2 two terms, best match first", () => {
  const p = project();
  p.card("root", "Root");
  p.card("cache-layout", "Cache layout", {
    parent: "root",
    status: "decided",
    body: "Cache eviction runs hourly. The eviction policy is LRU.",
  });
  p.card("eviction-timer", "Eviction timer", {
    parent: "root",
    why: "eviction must be timed",
    body: "CACHE warmup first",
  });
  p.card("cache-size", "Cache size", { parent: "root", status: "decided", body: "The cache holds 1 GB" });
  p.card("old-cache", "Old idea", { parent: "root", body: "cache eviction by hand" });
  expect(p.werk("remove", "old-cache", "--actor", "you").code).toBe(0);
  const lines = rows(p.werk("search", "cache", "eviction").out);
  expect(lines.length).toBe(2);
  expect(lines[0]).toMatch(/^cache-layout\s+decided\s+Cache layout$/);
  expect(lines[1]).toMatch(/^eviction-timer\s+open\s+Eviction timer$/);
  expect(lines.join("\n")).not.toContain("cache-size");
  expect(lines.join("\n")).not.toContain("old-cache");
});

test("09.3 find by rejected option word; narrow with --under and --status", () => {
  const p = project();
  p.card("root", "Root");
  p.card("parent-topic", "Parent topic", { parent: "root", status: "decided" });
  p.card("storage-format", "Storage format", { parent: "parent-topic", status: "decided", body: "One file per map" });
  p.seed("node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  p.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  p.card("other-open", "Other open", { parent: "root", body: "maybe sqlite later" });
  // "no title, why or body in the map says sqlite" except the open card's body, which the step adds.
  const all = p.werk("search", "sqlite").out;
  expect(all).toMatch(/^storage-format\s+decided\s+Storage format$/m);
  expect(all).toMatch(/^other-open\s+open\s/m);
  expect(ids(p, "search", "sqlite", "--under", "parent-topic")).toEqual(["storage-format"]);
  expect(ids(p, "search", "sqlite", "--status", "decided")).toEqual(["storage-format"]);
});

test("09.4 find open work under one card", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("client", "Client", { parent: "root", status: "decided" });
  p.card("routing", "Routing", { parent: "client" });
  p.card("theme", "Theme", { parent: "client", status: "proto" });
  p.card("route-guards", "Route guards", { parent: "routing" });
  // postponed: a decided card reopened as postponed; paused: an open card on it.
  p.card("postponed-card", "Postponed card", { parent: "client", status: "decided" });
  p.card("paused-card", "Paused card", { parent: "client" });
  p.seed("edge.added", { from: "paused-card", to: "postponed-card", type: "depends_on", why: "builds on it" });
  // stale: an open card on a card outside the tree that was reopened as rejected.
  p.card("outside-basis", "Outside basis", { parent: "root", status: "decided" });
  p.card("stale-card", "Stale card", { parent: "client" });
  p.seed("edge.added", { from: "stale-card", to: "outside-basis", type: "depends_on", why: "uses it" });
  p.seed("node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly urls" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.seed("node.added", { id: "router-doc", kind: "source", title: "Router doc", finding: "works" });
  p.seed("edge.added", { from: "routing", to: "router-doc", type: "supported_by" });
  p.card("billing", "Billing", { parent: "root" });
  expect(p.werk("reopen", "postponed-card", "--reason", "postponed", "--why", "later").code).toBe(0);
  expect(p.werk("reopen", "outside-basis", "--reason", "rejected", "--why", "wrong").code).toBe(0);
  const r = ids(p, "find", "routing");
  expect(r[0]).toBe("routing");
  expect(r.indexOf("route-guards")).toBeGreaterThan(0);
  for (const x of ["billing", "routing:opt0", "router-doc"]) expect(r).not.toContain(x);
  const c = ids(p, "find", "client");
  expect(c).toContain("routing");
  expect(c).toContain("theme");
  expect(c).toContain("route-guards");
  expect(c.indexOf("routing")).toBeLessThan(c.indexOf("route-guards"));
  expect(c.indexOf("theme")).toBeLessThan(c.indexOf("route-guards"));
  expect(c).not.toContain("client");
  for (const x of ["paused-card", "stale-card", "postponed-card"]) expect(c).not.toContain(x);
});

test("09.5 a rejected reopen comes back as work in every tree", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("open-a", "Open in tree one", { parent: "root" });
  p.card("second", "Second tree", { status: "decided" });
  p.card("open-b", "Open in tree two", { parent: "second" });
  p.card("auth-flow", "Auth flow", { parent: "root", status: "decided" });
  expect(p.werk("reopen", "auth-flow", "--reason", "rejected", "--why", "wrong").code).toBe(0);
  const out = p.werk("find").out;
  const r = rows(out).map((l) => l.split(/\s+/)[0]);
  expect(r).toContain("open-a");
  expect(r).toContain("open-b");
  expect(r).toContain("auth-flow");
  expect(out).not.toMatch(/\bdecided\b/);
  expect(r).not.toContain("root");
  expect(r).not.toContain("second");
});
