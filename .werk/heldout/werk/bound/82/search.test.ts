import { expect, test } from "bun:test";
import { all, card, freshProject, root, seed, w } from "./helpers.ts";

const dec = { status: "decided", who: "me" };
const lines = (t: string) => t.split("\n").filter((l) => l.trim() !== "");

test("[09.1] search with no term lists the decided cards only", async () => {
  const p = freshProject();
  root(p);
  card(p, "d1", { title: "Decided one", ...dec });
  card(p, "d2", { title: "Decided two", ...dec });
  card(p, "d3", { title: "Decided three", ...dec });
  card(p, "o1", { title: "Open one", status: "open" });
  seed(p, "node.proposed", { id: "gh", kind: "card", title: "Ghost card", parent: "root", status: "decided" });
  const r = await w(p, "search");
  expect(r.code).toBe(0);
  const ls = lines(r.out);
  expect(ls.length).toBe(3);
  for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(ls.some((l) => l.includes(id as string) && l.includes(t as string))).toBe(true);
  }
  expect(r.out).not.toContain("Open one");
  expect(r.out).not.toContain("Ghost card");
});

test("[09.2] search with two terms puts the best match first", async () => {
  const p = freshProject();
  root(p);
  card(p, "layout", { title: "Cache layout", body: "Cache eviction and the eviction policy", ...dec });
  card(p, "timer", { title: "Timer", why: "eviction", body: "CACHE warmup", status: "open" });
  card(p, "size", { title: "Cache size", body: "How big the cache is", ...dec });
  card(p, "gone", { title: "Gone", body: "cache eviction", ...dec });
  await w(p, "remove", "gone", "--actor", "you");
  const r = await w(p, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const ls = lines(r.out);
  expect(ls.length).toBe(2);
  expect(ls[0]).toContain("layout");
  expect(ls[0]).toContain("decided");
  expect(ls[0]).toContain("Cache layout");
  expect(ls[1]).toContain("timer");
  expect(ls[1]).toContain("open");
  expect(r.out).not.toContain("Cache size");
  expect(r.out).not.toContain("gone");
});

test("[09.3] search finds a card by a word in a rejected option and narrows", async () => {
  const p = freshProject();
  root(p);
  card(p, "parent", { title: "Parent topic", ...dec });
  card(p, "storage", { title: "Storage format", parent: "parent", ...dec });
  seed(p, "node.added", { id: "storage:o", kind: "option", title: "Use the database", why_not: "SQLite needs a native build" });
  seed(p, "edge.added", { from: "storage:o", to: "storage", type: "alternative_to" });
  card(p, "elsewhere", { title: "Elsewhere", body: "we could use sqlite here", status: "open" });
  const r = await w(p, "search", "sqlite");
  expect(r.out).toContain("Storage format");
  expect(r.out).toContain("decided");
  expect(r.out).toContain("Elsewhere");
  const r2 = await w(p, "search", "sqlite", "--under", "parent");
  expect(r2.out).toContain("Storage format");
  expect(r2.out).not.toContain("Elsewhere");
  expect(lines(r2.out).length).toBe(1);
  const r3 = await w(p, "search", "sqlite", "--status", "decided");
  expect(r3.out).toContain("Storage format");
  expect(r3.out).not.toContain("Elsewhere");
  expect(lines(r3.out).length).toBe(1);
});

test("[09.4] find lists the open work under one card", async () => {
  const p = freshProject();
  root(p);
  card(p, "client", { title: "Client", ...dec });
  card(p, "routing", { title: "Routing", parent: "client", status: "open" });
  card(p, "theme", { title: "Theme", parent: "client", status: "proto" });
  card(p, "guards", { title: "Route guards", parent: "routing", status: "open" });
  card(p, "paused", { title: "PausedCard", parent: "client", status: "open" });
  card(p, "stale", { title: "StaleCard", parent: "client", status: "open" });
  card(p, "postponed", { title: "PostponedCard", parent: "client", status: "open" });
  card(p, "basePost", { title: "bp", ...dec });
  card(p, "baseRej", { title: "br", ...dec });
  seed(p, "edge.added", { from: "paused", to: "basePost", type: "depends_on", why: "w" });
  seed(p, "edge.added", { from: "stale", to: "baseRej", type: "depends_on", why: "w" });
  seed(p, "node.reopened", { id: "basePost", reason: "postponed", why: "later" });
  seed(p, "node.reopened", { id: "baseRej", reason: "rejected", why: "bad" });
  seed(p, "node.added", { id: "postponed:x", kind: "card", title: "Postponed basis", status: "decided", who: "me" });
  seed(p, "edge.added", { from: "postponed", to: "postponed:x", type: "depends_on", why: "w" });
  seed(p, "node.reopened", { id: "postponed:x", reason: "postponed", why: "later" });
  seed(p, "node.added", { id: "routing:opt", kind: "option", title: "OptionNode", why_not: "x" });
  seed(p, "edge.added", { from: "routing:opt", to: "routing", type: "alternative_to" });
  seed(p, "node.added", { id: "routing:src", kind: "source", title: "SourceNode" });
  seed(p, "edge.added", { from: "routing", to: "routing:src", type: "supported_by" });
  card(p, "billing", { title: "Billing", status: "open" });
  const r = await w(p, "find", "routing");
  expect(r.code, all(r)).toBe(0);
  const iR = r.out.indexOf("Routing");
  const iG = r.out.indexOf("Route guards");
  expect(iR).toBeGreaterThanOrEqual(0);
  expect(iG).toBeGreaterThan(iR);
  for (const t of ["Billing", "OptionNode", "SourceNode"]) expect(r.out).not.toContain(t);
  const c = await w(p, "find", "client");
  expect(c.out).toContain("Routing");
  expect(c.out).toContain("Theme");
  expect(c.out.indexOf("Routing")).toBeLessThan(c.out.indexOf("Route guards"));
  expect(c.out.indexOf("Theme")).toBeLessThan(c.out.indexOf("Route guards"));
  expect(c.out).not.toMatch(/\bclient\b.*Client/);
  expect(lines(c.out).some((l) => /\bclient\b/.test(l) && l.includes("Client"))).toBe(false);
  for (const t of ["PausedCard", "StaleCard", "PostponedCard"]) expect(c.out).not.toContain(t);
});

test("[09.5] a card reopened as rejected comes back as work in every tree", async () => {
  const p = freshProject();
  root(p);
  card(p, "o1", { title: "Open in root tree", status: "open" });
  seed(p, "node.added", { id: "how", kind: "card", title: "How", status: "open" });
  card(p, "o2", { title: "Open in how tree", parent: "how", status: "open" });
  card(p, "auth", { title: "Auth flow", status: "decided", who: "me" });
  seed(p, "node.reopened", { id: "auth", reason: "rejected", why: "bad" });
  const r = await w(p, "find");
  expect(r.code, all(r)).toBe(0);
  expect(r.out).toContain("Open in root tree");
  expect(r.out).toContain("Open in how tree");
  expect(r.out).toContain("Auth flow");
  expect(r.out).not.toContain("[decided]");
  expect(r.out).not.toMatch(/\bdecided\b/);
});
