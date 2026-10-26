import { expect, test } from "bun:test";
import { card, ids, link, ok, withMap } from "./b-helpers.ts";

const T = 60_000;

test(
  "09.1",
  async () => {
    const p = withMap([
      card("root", "Root topic", undefined, "decided"),
      card("cache", "Cache layout", "root", "decided"),
      card("store", "Store format", "root", "decided"),
      card("timer", "Eviction timer", "root", "open"),
      ["node.proposed", { id: "ghosty", kind: "card", title: "A ghost card", status: "decided", parent: "root" }],
    ]);
    const out = (await ok(p, ["search"])).out;
    expect(out).toBe("root  Root topic\ncache  Cache layout\nstore  Store format\n");
    expect(ids(out)).not.toContain("timer");
    expect(ids(out)).not.toContain("ghosty");
  },
  T,
);

test(
  "09.2",
  async () => {
    const p = withMap([
      card("root", "Root", undefined, "decided"),
      card("cache-layout", "Cache layout", "root", "decided", {
        body: "Cache eviction runs per shard. The eviction policy is LRU.",
      }),
      card("eviction-timer", "Eviction timer", "root", "open", {
        why: "Stale entries need eviction.",
        body: "A CACHE warmup follows each run.",
      }),
      card("cache-size", "Cache size", "root", "decided", { body: "The cache holds 1 GB." }),
      card("old-cache", "Old cache eviction", "root", "open", { body: "cache eviction by age" }),
      ["node.removed", { id: "old-cache" }],
    ]);
    const out = (await ok(p, ["search", "cache", "eviction"])).out;
    expect(out).toBe("cache-layout  decided  Cache layout\neviction-timer  open  Eviction timer\n");
    expect(ids(out)).not.toContain("cache-size");
    expect(ids(out)).not.toContain("old-cache");
  },
  T,
);

test(
  "09.3",
  async () => {
    const p = withMap([
      card("root", "Root", undefined, "decided"),
      card("parent-topic", "Parent topic", "root", "decided"),
      card("storage-format", "Storage format", "parent-topic", "decided", { body: "The map is a JSON lines log." }),
      [
        "node.added",
        { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
      ],
      link("storage-format:opt0", "storage-format", "alternative_to"),
      card("local-db", "Local database", "root", "open", { body: "Try sqlite for the cache." }),
    ]);
    const all = ids((await ok(p, ["search", "sqlite"])).out);
    expect(all).toContain("storage-format");
    expect((await ok(p, ["search", "sqlite"])).out).toContain("storage-format  decided  Storage format");
    expect(all).toContain("local-db");
    expect(ids((await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out)).toEqual(["storage-format"]);
    expect(ids((await ok(p, ["search", "sqlite", "--status", "decided"])).out)).toEqual(["storage-format"]);
  },
  T,
);

test(
  "09.4",
  async () => {
    const p = withMap([
      card("infra", "Infra", undefined, "decided"),
      card("dep-postponed", "A dependency postponed", "infra", "decided"),
      card("dep-rejected", "A dependency rejected", "infra", "decided"),
      card("client", "Client", undefined, "decided"),
      card("routing", "Routing", "client", "open"),
      card("theme", "Theme", "client", "proto"),
      card("route-guards", "Route guards", "routing", "open"),
      card("paused-card", "Paused card", "client", "open"),
      card("stale-card", "Stale card", "client", "open"),
      card("postponed-card", "Postponed card", "client", "decided"),
      link("paused-card", "dep-postponed", "depends_on", "needs it"),
      link("stale-card", "dep-rejected", "depends_on", "needs it"),
      ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "Ugly URLs" }],
      link("routing:opt0", "routing", "alternative_to"),
      ["node.added", { id: "router-docs", kind: "source", title: "Router docs", url: "https://example.invalid/r" }],
      link("routing", "router-docs", "supported_by"),
      card("billing-root", "Billing area", undefined, "decided"),
      card("billing", "Billing", "billing-root", "open"),
      ["node.reopened", { id: "dep-postponed", reason: "postponed" }],
      ["node.reopened", { id: "dep-rejected", reason: "rejected" }],
      ["node.reopened", { id: "postponed-card", reason: "postponed" }],
    ]);
    // sanity: the marks are as the Given says
    expect((await ok(p, ["show", "paused-card"])).out).toContain("paused");
    expect((await ok(p, ["show", "stale-card"])).out).toContain("stale");

    const r = ids((await ok(p, ["find", "routing"])).out);
    expect(r[0]).toBe("routing");
    expect(r).toContain("route-guards");
    expect(r.indexOf("route-guards")).toBeGreaterThan(0);
    for (const x of ["billing", "routing:opt0", "router-docs"]) expect(r).not.toContain(x);

    const c = ids((await ok(p, ["find", "client"])).out);
    expect(c).toContain("routing");
    expect(c).toContain("theme");
    expect(c).toContain("route-guards");
    expect(c.indexOf("routing")).toBeLessThan(c.indexOf("route-guards"));
    expect(c.indexOf("theme")).toBeLessThan(c.indexOf("route-guards"));
    for (const x of ["client", "paused-card", "stale-card", "postponed-card"]) expect(c).not.toContain(x);
  },
  T,
);

test(
  "09.5",
  async () => {
    const p = withMap([
      card("tree-a", "Tree A", undefined, "decided"),
      card("open-a", "Open in A", "tree-a", "open"),
      card("auth-flow", "Auth flow", "tree-a", "decided"),
      card("tree-b", "Tree B", undefined, "decided"),
      card("open-b", "Open in B", "tree-b", "open"),
      ["node.reopened", { id: "auth-flow", reason: "rejected" }],
    ]);
    const out = (await ok(p, ["find"])).out;
    const found = ids(out);
    expect(found).toContain("open-a");
    expect(found).toContain("open-b");
    expect(found).toContain("auth-flow");
    expect(out).not.toContain("decided");
    for (const x of ["tree-a", "tree-b"]) expect(found).not.toContain(x);
  },
  T,
);
