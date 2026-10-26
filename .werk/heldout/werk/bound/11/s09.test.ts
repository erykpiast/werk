import { expect, test } from "bun:test";
import { card, ok, seeded } from "./helpers.ts";

const outLines = (out: string) => out.split("\n").filter((l) => l !== "");

test("09.1 an agent lists the index of decided cards", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("alpha", "Alpha rule", { parent: "root", status: "decided" }),
    card("beta", "Beta rule", { parent: "root", status: "decided" }),
    card("gamma", "Gamma open", { parent: "root" }),
    ["node.proposed", { id: "delta", kind: "card", title: "Delta ghost", parent: "root" }],
    ["node.decided", { id: "delta" }],
  ]);
  const shown = (await ok(p, ["show", "delta"])).out.split("\n")[0];
  expect(shown).toContain("[decided]");
  expect(shown).toContain("proposed");
  const out = outLines((await ok(p, ["search"])).out);
  expect(out.length).toBe(3);
  expect(out).toContain("root  Root");
  expect(out).toContain("alpha  Alpha rule");
  expect(out).toContain("beta  Beta rule");
  expect(out.join("\n")).not.toContain("gamma");
  expect(out.join("\n")).not.toContain("delta");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = seeded([
    card("root", "Root"),
    card("cache-layout", "Cache layout", {
      parent: "root",
      status: "decided",
      body: "Cache eviction follows the eviction policy.",
    }),
    card("eviction-timer", "Eviction timer", { parent: "root", why: "The eviction runs often.", body: "CACHE warmup first." }),
    card("cache-size", "Cache size", { parent: "root", status: "decided", body: "The cache holds 1 GB." }),
    card("old-cache", "Old cache eviction", { parent: "root", body: "cache eviction" }),
  ]);
  await ok(p, ["remove", "old-cache", "--actor", "you"]);
  const out = outLines((await ok(p, ["search", "cache", "eviction"])).out);
  expect(out).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = seeded([
    card("parent-topic", "Parent topic", { status: "decided" }),
    card("storage-format", "Storage format", { parent: "parent-topic", status: "decided", body: "Logs are JSON lines." }),
    ["node.added", { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" }],
    ["edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" }],
    card("other-root", "Other root"),
    card("cache-store", "Cache store", { parent: "other-root", body: "Maybe sqlite for the cache." }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all).toContain("cache-store  open  Cache store");
  const under = outLines((await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out);
  expect(under).toEqual(["storage-format  decided  Storage format"]);
  const decided = outLines((await ok(p, ["search", "sqlite", "--status", "decided"])).out);
  expect(decided).toEqual(["storage-format  decided  Storage format"]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = seeded([
    card("client", "Client", { status: "decided" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("route-guards", "Route guards", { parent: "routing" }),
    card("upstream", "Upstream", { status: "decided" }),
    card("upstream2", "Upstream two", { status: "decided" }),
    card("paused-card", "Paused card", { parent: "client" }),
    card("stale-card", "Stale card", { parent: "client" }),
    card("postponed-card", "Postponed card", { parent: "client", status: "decided" }),
    ["edge.added", { from: "paused-card", to: "upstream", type: "depends_on", why: "uses upstream" }],
    ["edge.added", { from: "stale-card", to: "upstream2", type: "depends_on", why: "uses upstream two" }],
    ["node.reopened", { id: "upstream", reason: "postponed" }],
    ["node.reopened", { id: "upstream2", reason: "invalidated" }],
    ["node.reopened", { id: "postponed-card", reason: "postponed" }],
    ["node.added", { id: "routing:opt0", kind: "option", title: "Routing option", why_not: "No" }],
    ["edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" }],
    ["node.added", { id: "routing-src", kind: "source", title: "Routing source" }],
    ["edge.added", { from: "routing", to: "routing-src", type: "supported_by" }],
    card("billing-root", "Billing root", { status: "decided" }),
    card("billing", "Billing", { parent: "billing-root" }),
  ]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("paused-card");
  expect(stale).toContain("stale-card");
  const r = outLines((await ok(p, ["find", "routing"])).out);
  expect(r[0]).toStartWith("routing ");
  expect(r[1]).toStartWith("route-guards ");
  expect(r.join("\n")).not.toMatch(/billing|routing:opt0|routing-src|Routing option|Routing source/);
  const c = outLines((await ok(p, ["find", "client"])).out);
  const ids = c.map((l) => l.split(" ")[0]);
  expect(ids).toContain("routing");
  expect(ids).toContain("theme");
  expect(ids).toContain("route-guards");
  expect(ids.indexOf("routing")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids.indexOf("theme")).toBeLessThan(ids.indexOf("route-guards"));
  expect(ids).not.toContain("client");
  expect(ids).not.toContain("paused-card");
  expect(ids).not.toContain("stale-card");
  expect(ids).not.toContain("postponed-card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = seeded([
    card("tree-a", "Tree A", { status: "decided" }),
    card("work-a", "Work A", { parent: "tree-a" }),
    card("tree-b", "Tree B", { status: "decided" }),
    card("work-b", "Work B", { parent: "tree-b" }),
    card("auth-flow", "Auth flow", { parent: "tree-a", status: "decided" }),
  ]);
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected", "--why", "The flow is wrong"]);
  const ids = outLines((await ok(p, ["find"])).out).map((l) => l.split(" ")[0]);
  expect(ids).toContain("work-a");
  expect(ids).toContain("work-b");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree-a");
  expect(ids).not.toContain("tree-b");
});
