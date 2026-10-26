// Held-out steps 09.x: the index, the search and the find of the map.
import { expect, test } from "bun:test";
import { card, decided, ok, seeded } from "./helpers.ts";

const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});
const outLines = (out: string) => out.split("\n").filter((line) => line !== "");

test("09.1 an agent lists the index of decided cards", async () => {
  const p = seeded([
    decided("alpha", "Alpha rule"),
    decided("beta", "Beta rule", { parent: "alpha" }),
    decided("gamma", "Gamma rule", { parent: "alpha" }),
    card("delta", "Delta open", { parent: "alpha" }),
    { type: "node.proposed", actor: "agent", payload: { id: "ghosty", kind: "card", title: "Ghost rule", parent: "alpha" } },
    { type: "node.decided", actor: "agent", payload: { id: "ghosty" } },
  ]);
  const out = (await ok(p, ["search"])).out;
  const ls = outLines(out);
  expect(ls).toHaveLength(3);
  expect(ls).toContain("alpha  Alpha rule");
  expect(ls).toContain("beta  Beta rule");
  expect(ls).toContain("gamma  Gamma rule");
  expect(out).not.toContain("delta");
  expect(out).not.toContain("ghosty");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = seeded([
    decided("cache-layout", "Cache layout", { body: "Cache eviction runs hourly. The eviction policy is LRU." }),
    card("eviction-timer", "Eviction timer", { why: "The eviction must run on time.", body: "It skips the CACHE warmup." }),
    decided("cache-size", "Cache size", { body: "The cache holds 1 GB." }),
    decided("old-cache", "Old cache eviction", { body: "cache eviction by age" }),
    { type: "node.removed", payload: { id: "old-cache" } },
  ]);
  const ls = outLines((await ok(p, ["search", "cache", "eviction"])).out);
  expect(ls).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = seeded([
    decided("parent-topic", "Parent topic"),
    decided("storage-format", "Storage format", { parent: "parent-topic", body: "The map is one JSON log." }),
    { type: "node.added", payload: { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" } },
    edge("storage-format:opt0", "storage-format", "alternative_to"),
    decided("other-root", "Other root"),
    card("embedded-db", "Embedded database", { parent: "other-root", body: "Maybe sqlite for the cache." }),
  ]);
  const all = outLines((await ok(p, ["search", "sqlite"])).out);
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all).toContain("embedded-db  open  Embedded database");
  expect(outLines((await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out)).toEqual([
    "storage-format  decided  Storage format",
  ]);
  expect(outLines((await ok(p, ["search", "sqlite", "--status", "decided"])).out)).toEqual([
    "storage-format  decided  Storage format",
  ]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = seeded([
    decided("client", "Client"),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("route-guards", "Route guards", { parent: "routing" }),
    decided("deferred", "Deferred work", { parent: "client" }),
    card("paused-card", "Paused card", { parent: "client" }),
    edge("paused-card", "deferred", "depends_on", "it builds on the deferred work"),
    decided("upstream", "Upstream rule"),
    card("stale-card", "Stale card", { parent: "client" }),
    edge("stale-card", "upstream", "depends_on", "it follows the upstream rule"),
    { type: "node.added", payload: { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "Ugly URLs" } },
    edge("routing:opt0", "routing", "alternative_to"),
    { type: "node.added", payload: { id: "router-docs", kind: "source", title: "Router docs", finding: "History API" } },
    edge("routing", "router-docs", "supported_by"),
    decided("finance", "Finance"),
    card("billing", "Billing", { parent: "finance" }),
  ]);
  await ok(p, ["reopen", "deferred", "--reason", "postponed", "--why", "later"]);
  await ok(p, ["reopen", "upstream", "--reason", "invalidated", "--why", "changed"]);

  const marks = (await ok(p, ["stale"])).out;
  expect(marks).toContain("paused-card");
  expect(marks).toContain("stale-card");
  const routing = outLines((await ok(p, ["find", "routing"])).out);
  expect(routing.map((l) => l.split("  ")[0])).toEqual(["routing", "route-guards"]);

  const client = outLines((await ok(p, ["find", "client"])).out).map((l) => l.split("  ")[0]);
  expect(client).toContain("routing");
  expect(client).toContain("theme");
  expect(client).toContain("route-guards");
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("route-guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("route-guards"));
  for (const id of ["client", "paused-card", "stale-card", "deferred", "billing", "routing:opt0", "router-docs"])
    expect(client).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = seeded([
    decided("tree-one", "Tree one"),
    card("open-one", "Open one", { parent: "tree-one" }),
    decided("tree-two", "Tree two"),
    card("open-two", "Open two", { parent: "tree-two" }),
    decided("auth-flow", "Auth flow", { parent: "tree-one" }),
  ]);
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected", "--why", "wrong flow"]);
  const ids = outLines((await ok(p, ["find"])).out).map((l) => l.split("  ")[0]);
  expect(ids).toContain("open-one");
  expect(ids).toContain("open-two");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree-one");
  expect(ids).not.toContain("tree-two");
});
