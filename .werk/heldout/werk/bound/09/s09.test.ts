import { expect, test } from "bun:test";
import { card, decided, ghost, link, ok, reopen, withMap } from "./helpers.ts";

const ids = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split(/\s+/)[0]);

test("09.1", async () => {
  const p = withMap([
    card("one", "First decided", undefined, { status: "decided" }),
    card("two", "Second decided", undefined, { status: "decided" }),
    card("three", "Third decided", undefined, { status: "decided" }),
    card("four", "Still open"),
    // A ghost that reached decided before its accept.
    ghost("five", "Decided ghost"),
    decided("five"),
  ]);
  const out = (await ok(p, ["search"])).out;
  expect(out).toContain("one  First decided");
  expect(out).toContain("two  Second decided");
  expect(out).toContain("three  Third decided");
  expect(ids(out)).toEqual(["one", "two", "three"]);
});

test("09.2", async () => {
  const p = withMap([
    card("cache-layout", "Cache layout", undefined, {
      status: "decided",
      body: "Cache eviction runs hourly. The eviction policy is LRU.",
    }),
    card("eviction-timer", "Eviction timer", undefined, {
      why: "The eviction runs on a timer.",
      body: "CACHE warmup first.",
    }),
    card("cache-size", "Cache size", undefined, { status: "decided", body: "The cache holds 1 GB." }),
    card("old-cache", "Old cache eviction", undefined, { status: "decided", body: "cache eviction" }),
    ["node.removed", { id: "old-cache" }],
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  const rows = out.split("\n").filter((l) => l !== "");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toBe("cache-layout  decided  Cache layout");
  expect(rows[1]).toBe("eviction-timer  open  Eviction timer");
  expect(out).not.toContain("cache-size");
  expect(out).not.toContain("old-cache");
});

test("09.3", async () => {
  const p = withMap([
    card("parent-topic", "Parent topic", undefined, { status: "decided" }),
    card("storage-format", "Storage format", "parent-topic", { status: "decided" }),
    [
      "node.added",
      { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
    ],
    link("storage-format:opt0", "storage-format", "alternative_to"),
    card("elsewhere", "Embedded database", undefined, { body: "Maybe sqlite later." }),
  ]);
  // The Given says no title, why or body says "sqlite" — the open card's body does; it is the step's own open card.
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all).toContain("elsewhere");
  const under = (await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out;
  expect(ids(under)).toEqual(["storage-format"]);
  const dec = (await ok(p, ["search", "sqlite", "--status", "decided"])).out;
  expect(ids(dec)).toEqual(["storage-format"]);
});

test("09.4", async () => {
  const p = withMap([
    card("client", "Client", undefined, { status: "decided" }),
    card("routing", "Routing", "client"),
    card("theme", "Theme", "client", { status: "proto" }),
    card("route-guards", "Route guards", "routing"),
    card("upstream-p", "Upstream postponed", undefined, { status: "decided" }),
    card("upstream-s", "Upstream invalidated", undefined, { status: "decided" }),
    card("paused", "Paused card", "client"),
    card("stale", "Stale card", "client"),
    card("postponed", "Postponed card", "client", { status: "decided" }),
    link("paused", "upstream-p", "depends_on", "uses it"),
    link("stale", "upstream-s", "depends_on", "uses it"),
    reopen("upstream-p", "postponed"),
    reopen("upstream-s", "invalidated"),
    reopen("postponed", "postponed"),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "Ugly" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "src-router", kind: "source", title: "Router docs", url: "https://example.com" }],
    link("routing", "src-router", "supported_by"),
    card("billing", "Billing"),
  ]);
  const routing = ids((await ok(p, ["find", "routing"])).out);
  expect(routing[0]).toBe("routing");
  expect(routing.indexOf("route-guards")).toBeGreaterThan(0);
  for (const id of ["billing", "routing:opt0", "src-router"]) expect(routing).not.toContain(id);

  const client = ids((await ok(p, ["find", "client"])).out);
  expect(client).toContain("routing");
  expect(client).toContain("theme");
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("route-guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("route-guards"));
  for (const id of ["client", "paused", "stale", "postponed"]) expect(client).not.toContain(id);
});

test("09.5", async () => {
  const p = withMap([
    card("tree-a", "Tree A", undefined, { status: "decided" }),
    card("open-a", "Open in A", "tree-a"),
    card("tree-b", "Tree B", undefined, { status: "decided" }),
    card("open-b", "Open in B", "tree-b"),
    card("auth-flow", "Auth flow", "tree-a", { status: "decided" }),
    reopen("auth-flow", "rejected"),
  ]);
  const found = ids((await ok(p, ["find"])).out);
  expect(found).toContain("open-a");
  expect(found).toContain("open-b");
  expect(found).toContain("auth-flow");
  for (const id of ["tree-a", "tree-b"]) expect(found).not.toContain(id);
});
