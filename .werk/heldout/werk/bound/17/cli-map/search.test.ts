// Steps 09.1–09.5: search and find on the command line.
import { expect, test } from "bun:test";
import { project } from "./helper.ts";

const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

test("09.1 an agent lists the index of decided cards", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("d1", "First decided", { parent: "root", status: "decided" });
  p.card("d2", "Second decided", { parent: "root", status: "decided" });
  p.card("o1", "Open one", { parent: "root" });
  // A ghost card, decided while it was a ghost.
  p.seed("node.proposed", { id: "gh", kind: "card", title: "Ghost one", parent: "root", status: "decided" });
  expect(p.werk("show", "gh").out).toMatch(/\[decided\]\s+proposed/);
  const r = p.werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.out);
  for (const [id, title] of [["root", "Root"], ["d1", "First decided"], ["d2", "Second decided"]])
    expect(out.some((l) => l.includes(id) && l.includes(title))).toBe(true);
  expect(out.length).toBe(3);
  expect(r.out).not.toContain("Open one");
  expect(r.out).not.toContain("Ghost one");
});

test("09.2 two terms, best match first", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("cache-layout", "Cache layout", {
    parent: "root",
    status: "decided",
    body: "Cache eviction runs on a timer. The eviction policy is LRU.",
  });
  p.card("eviction-timer", "Eviction timer", { parent: "root", why: "Stale entries need eviction.", body: "CACHE warmup first." });
  p.card("cache-size", "Cache size", { parent: "root", status: "decided", body: "The cache holds 100 entries." });
  p.card("gone", "Gone card", { parent: "root", body: "cache eviction" });
  expect(p.werk("remove", "gone", "--actor", "you").code).toBe(0);
  const r = p.werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.out);
  expect(out.length).toBe(2);
  expect(out[0]).toMatch(/cache-layout\s+decided\s+Cache layout/);
  expect(out[1]).toMatch(/eviction-timer\s+open\s+Eviction timer/);
  expect(r.out).not.toContain("Cache size");
  expect(r.out).not.toContain("Gone card");
});

test("09.3 a word in a rejected option finds the card, and the search narrows", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("parent-topic", "Parent topic", { parent: "root", status: "decided" });
  p.card("storage-format", "Storage format", { parent: "parent-topic", status: "decided" });
  p.seed("node.added", { id: "storage-format:opt0", kind: "option", title: "Embedded database", why_not: "SQLite needs a native build" });
  p.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  p.card("elsewhere", "Elsewhere", { parent: "root", body: "Try sqlite here." });
  const all = p.werk("search", "sqlite").out;
  expect(all).toMatch(/storage-format\s+decided\s+Storage format/);
  expect(all).toContain("elsewhere");
  const under = lines(p.werk("search", "sqlite", "--under", "parent-topic").out);
  expect(under.length).toBe(1);
  expect(under[0]).toContain("storage-format");
  const decided = lines(p.werk("search", "sqlite", "--status", "decided").out);
  expect(decided.length).toBe(1);
  expect(decided[0]).toContain("storage-format");
});

test("09.4 the open work under one card", () => {
  const p = project();
  p.card("client", "Client", { status: "decided" });
  p.card("routing", "Routing", { parent: "client" });
  p.card("theme", "Theme", { parent: "client", status: "proto" });
  p.card("route-guards", "Route guards", { parent: "routing" });
  // The postponed card: decided, then reopened as postponed.
  p.card("postponed-card", "Postponed card", { parent: "client", status: "decided" });
  // The paused card: open, downstream of the postponed card.
  p.card("paused-card", "Paused card", { parent: "client" });
  p.seed("edge.added", { from: "paused-card", to: "postponed-card", type: "depends_on", why: "needs it" });
  // The stale card: open, on a basis that is reopened as invalidated.
  p.card("basis", "Basis", { status: "decided" });
  p.card("stale-card", "Stale card", { parent: "client" });
  p.seed("edge.added", { from: "stale-card", to: "basis", type: "depends_on", why: "needs it" });
  p.seed("node.added", { id: "routing:opt0", kind: "option", title: "Routing option", why_not: "no" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.seed("node.added", { id: "routing-src", kind: "source", title: "Routing source", url: "https://example.com" });
  p.seed("edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  p.card("billing", "Billing", {});
  expect(p.werk("reopen", "postponed-card", "--reason", "postponed").code).toBe(0);
  expect(p.werk("reopen", "basis", "--reason", "invalidated").code).toBe(0);
  const stale = p.werk("stale").out;
  expect(stale).toContain("paused-card");
  expect(stale).toContain("stale-card");

  const r = lines(p.werk("find", "routing").out);
  expect(r[0]).toContain("routing");
  expect(r[1]).toContain("route-guards");
  const rText = r.join("\n");
  for (const no of ["billing", "routing:opt0", "routing-src"]) expect(rText).not.toContain(no);

  const c = lines(p.werk("find", "client").out);
  const idx = (id: string) => c.findIndex((l) => l.split(/\s+/)[0] === id);
  expect(idx("routing")).toBeGreaterThanOrEqual(0);
  expect(idx("theme")).toBeGreaterThanOrEqual(0);
  expect(idx("routing")).toBeLessThan(idx("route-guards"));
  expect(idx("theme")).toBeLessThan(idx("route-guards"));
  for (const no of ["client", "paused-card", "stale-card", "postponed-card"]) expect(idx(no)).toBe(-1);
});

test("09.5 a card reopened as rejected comes back as work in every tree", () => {
  const p = project();
  p.card("tree1", "Tree one", { status: "decided" });
  p.card("open1", "Open in one", { parent: "tree1" });
  p.card("tree2", "Tree two", { status: "decided" });
  p.card("open2", "Open in two", { parent: "tree2" });
  p.card("auth-flow", "Auth flow", { parent: "tree1", status: "decided" });
  expect(p.werk("reopen", "auth-flow", "--reason", "rejected").code).toBe(0);
  const out = lines(p.werk("find").out);
  const ids = out.map((l) => l.split(/\s+/)[0]);
  expect(ids).toContain("open1");
  expect(ids).toContain("open2");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree1");
  expect(ids).not.toContain("tree2");
  expect(out.join("\n")).not.toMatch(/decided/);
});
