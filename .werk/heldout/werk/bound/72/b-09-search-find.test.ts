import { expect, test } from "bun:test";
import { decided, project } from "./b-helpers.ts";

const lines = (out: string) => out.trim().split("\n").filter(Boolean);

test("09.1 an agent lists the index of decided cards", async () => {
  const p = project();
  decided(p, "alpha", { title: "Alpha decided" });
  decided(p, "beta", { title: "Beta decided" });
  decided(p, "gamma", { title: "Gamma decided" });
  p.card("delta", { title: "Delta open" });
  p.seed(
    "node.proposed",
    { id: "ghosty", kind: "card", title: "Ghost decided", status: "decided", who: "me" },
    "agent",
  );
  const out = await p.must(["search"]);
  const ls = lines(out);
  expect(ls).toHaveLength(3);
  for (const [id, title] of [
    ["alpha", "Alpha decided"],
    ["beta", "Beta decided"],
    ["gamma", "Gamma decided"],
  ]) {
    expect(ls.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(out).not.toContain("delta");
  expect(out).not.toContain("Delta open");
  expect(out).not.toContain("ghosty");
  expect(out).not.toContain("Ghost decided");
});

test("09.2 two terms, best match first", async () => {
  const p = project();
  decided(p, "cache-layout", {
    title: "Cache layout",
    body: "Cache eviction keeps memory small. The eviction policy is LRU.",
  });
  p.card("eviction-timer", { title: "Eviction timer", why: "eviction runs on a timer", body: "CACHE warmup first" });
  decided(p, "cache-size", { title: "Cache size", body: "The cache holds 100 entries" });
  decided(p, "gone", { title: "Gone card", body: "cache eviction too" });
  const rm = await p.werk(["remove", "gone", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const out = await p.must(["search", "cache", "eviction"]);
  const ls = lines(out);
  expect(ls).toHaveLength(2);
  expect(ls[0]).toContain("cache-layout");
  expect(ls[0]).toContain("decided");
  expect(ls[0]).toContain("Cache layout");
  expect(ls[1]).toContain("eviction-timer");
  expect(ls[1]).toContain("open");
  expect(ls[1]).toContain("Eviction timer");
  expect(out).not.toContain("Cache size");
  expect(out).not.toContain("gone");
});

test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
  const p = project();
  decided(p, "parent-topic", { title: "Parent topic" });
  decided(p, "storage-format", { title: "Storage format", parent: "parent-topic" });
  p.card("storage-format:opt0", { kind: "option", title: "Embedded database", why_not: "SQLite needs a native build" });
  p.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  p.card("outside", { title: "Outside card", body: "maybe sqlite later" });
  const all = await p.must(["search", "sqlite"]);
  const sf = lines(all).find((l) => l.includes("storage-format") && !l.includes("opt0"));
  expect(sf).toBeDefined();
  expect(sf).toContain("decided");
  expect(all).toContain("outside");
  const under = lines(await p.must(["search", "sqlite", "--under", "parent-topic"]));
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("storage-format");
  const dec = lines(await p.must(["search", "sqlite", "--status", "decided"]));
  expect(dec).toHaveLength(1);
  expect(dec[0]).toContain("storage-format");
});

test("09.4 find the open work under one card", async () => {
  const p = project();
  decided(p, "client", { title: "Client" });
  p.card("routing", { title: "Routing", parent: "client" });
  p.card("theme", { title: "Theme", parent: "client", status: "proto" });
  p.card("route-guards", { title: "Route guards", parent: "routing" });
  // Bases outside the tree, whose reopen marks the cards under Client.
  decided(p, "base-p", { title: "Base postponed" });
  decided(p, "base-s", { title: "Base rejected" });
  p.card("paused-card", { title: "Paused card", parent: "client" });
  p.seed("edge.added", { from: "paused-card", to: "base-p", type: "depends_on", why: "needs base p" });
  p.card("stale-card", { title: "Stale card", parent: "client" });
  p.seed("edge.added", { from: "stale-card", to: "base-s", type: "depends_on", why: "needs base s" });
  decided(p, "postponed-card", { title: "Postponed card", parent: "client" });
  p.card("routing:opt0", { kind: "option", title: "Routing option", why_not: "no" });
  p.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  p.card("routing-src", { kind: "source", title: "Routing source", finding: "f" });
  p.seed("edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  p.card("billing", { title: "Billing" });
  await p.must(["reopen", "base-p", "--reason", "postponed", "--why", "later"]);
  await p.must(["reopen", "base-s", "--reason", "rejected", "--why", "wrong"]);
  await p.must(["reopen", "postponed-card", "--reason", "postponed", "--why", "later"]);

  const r = lines(await p.must(["find", "routing"]));
  expect(r[0]).toContain("routing");
  expect(r[0]).toContain("Routing");
  expect(r.findIndex((l) => l.includes("Route guards"))).toBeGreaterThan(0);
  const rj = r.join("\n");
  expect(rj).not.toContain("Billing");
  expect(rj).not.toContain("Routing option");
  expect(rj).not.toContain("Routing source");

  const c = lines(await p.must(["find", "client"]));
  const at = (t: string) => c.findIndex((l) => l.includes(t));
  expect(at("  Routing")).toBeGreaterThanOrEqual(0);
  expect(at("Theme")).toBeGreaterThanOrEqual(0);
  expect(at("Route guards")).toBeGreaterThan(at("  Routing"));
  expect(at("Route guards")).toBeGreaterThan(at("Theme"));
  const cj = c.join("\n");
  expect(c.some((l) => l.startsWith("client "))).toBe(false);
  expect(cj).not.toContain("Paused card");
  expect(cj).not.toContain("Stale card");
  expect(cj).not.toContain("Postponed card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = project();
  decided(p, "tree-one", { title: "Tree one" });
  p.card("open-one", { title: "Open one", parent: "tree-one" });
  decided(p, "tree-two", { title: "Tree two" });
  p.card("open-two", { title: "Open two", parent: "tree-two" });
  decided(p, "auth-flow", { title: "Auth flow", parent: "tree-two" });
  await p.must(["reopen", "auth-flow", "--reason", "rejected", "--why", "bad"]);
  const out = await p.must(["find"]);
  expect(out).toContain("Open one");
  expect(out).toContain("Open two");
  expect(out).toContain("Auth flow");
  expect(out).not.toContain("decided");
  expect(out).not.toContain("Tree one");
  expect(out).not.toContain("Tree two");
});
