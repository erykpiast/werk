import { expect, test } from "bun:test";
import { card, decided, ok, project, seed } from "./helpers.ts";

const outLines = (s: string) => s.split("\n").filter((l) => l !== "");

test("09.1 an agent lists the index of decided cards", async () => {
  const p = project();
  seed(p, [
    card("d-one", "First decided"),
    card("d-two", "Second decided"),
    card("d-three", "Third decided"),
    card("o-one", "Open card"),
    { type: "node.proposed", payload: { id: "g-one", kind: "card", title: "Ghost card" } },
    decided("d-one"),
    decided("d-two"),
    decided("d-three"),
    decided("g-one"),
  ]);
  const run = await ok(p, ["search"]);
  const ls = outLines(run.out);
  expect(ls.length).toBe(3);
  expect(ls).toContain("d-one  First decided");
  expect(ls).toContain("d-two  Second decided");
  expect(ls).toContain("d-three  Third decided");
  expect(run.out).not.toContain("o-one");
  expect(run.out).not.toContain("g-one");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = project();
  seed(p, [
    card("cache-layout", "Cache layout", { body: "Cache eviction runs on an eviction policy." }),
    card("eviction-timer", "Eviction timer", { why: "eviction must run on time", body: "CACHE warmup first." }),
    card("cache-size", "Cache size", { body: "The cache holds 100 entries." }),
    card("old-cache", "Old cache plan", { body: "cache eviction by hand" }),
    decided("cache-layout"),
    decided("cache-size"),
  ]);
  await ok(p, ["remove", "old-cache", "--actor", "you"]);
  const run = await ok(p, ["search", "cache", "eviction"]);
  const ls = outLines(run.out);
  expect(ls).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
  expect(run.out).not.toContain("cache-size");
  expect(run.out).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = project();
  seed(p, [
    card("parent-topic", "Parent topic"),
    card("storage-format", "Storage format", { parent: "parent-topic", body: "One JSON line per event." }),
    { type: "node.added", payload: { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" } },
    { type: "edge.added", payload: { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" } },
    card("elsewhere", "Embedded store idea", { body: "Try sqlite for the cache." }),
    decided("parent-topic"),
    decided("storage-format"),
  ]);
  const all = outLines((await ok(p, ["search", "sqlite"])).out);
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all).toContain("elsewhere  open  Embedded store idea");
  const under = outLines((await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out);
  expect(under).toEqual(["storage-format  decided  Storage format"]);
  const st = outLines((await ok(p, ["search", "sqlite", "--status", "decided"])).out);
  expect(st).toEqual(["storage-format  decided  Storage format"]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = project();
  seed(p, [
    card("client", "Client"),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { parent: "client", status: "proto" }),
    card("route-guards", "Route guards", { parent: "routing" }),
    card("paused-card", "Paused card", { parent: "client" }),
    card("stale-card", "Stale card", { parent: "client" }),
    card("postponed-card", "Postponed card", { parent: "client" }),
    { type: "node.added", payload: { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "ugly URLs" } },
    { type: "edge.added", payload: { from: "routing:opt0", to: "routing", type: "alternative_to" } },
    { type: "node.added", payload: { id: "router-docs", kind: "source", title: "Router docs", finding: "history API works" } },
    { type: "edge.added", payload: { from: "routing", to: "router-docs", type: "supported_by" } },
    card("billing", "Billing"),
    card("basis", "Basis tree"),
    card("pause-basis", "Pause basis", { parent: "basis" }),
    card("stale-basis", "Stale basis", { parent: "basis" }),
    { type: "edge.added", payload: { from: "paused-card", to: "pause-basis", type: "depends_on", why: "needs it" } },
    { type: "edge.added", payload: { from: "stale-card", to: "stale-basis", type: "depends_on", why: "needs it" } },
    decided("client"),
    decided("basis"),
    decided("pause-basis"),
    decided("stale-basis"),
    decided("postponed-card"),
    { type: "node.reopened", payload: { id: "pause-basis", reason: "postponed", why: "later" } },
    { type: "node.reopened", payload: { id: "stale-basis", reason: "invalidated", why: "wrong" } },
    { type: "node.reopened", payload: { id: "postponed-card", reason: "postponed", why: "later" } },
  ]);
  const stale = await ok(p, ["stale"]);
  expect(stale.out).toContain("paused-card");
  expect(stale.out).toContain("stale-card");
  const routing = outLines((await ok(p, ["find", "routing"])).out).map((l) => l.split("  ")[0]);
  expect(routing).toEqual(["routing", "route-guards"]);
  const client = outLines((await ok(p, ["find", "client"])).out).map((l) => l.split("  ")[0]);
  expect(client).not.toContain("billing");
  expect(client).not.toContain("routing:opt0");
  expect(client).not.toContain("router-docs");
  expect(client).not.toContain("client");
  expect(client).not.toContain("paused-card");
  expect(client).not.toContain("stale-card");
  expect(client).not.toContain("postponed-card");
  expect(client.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(client.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("route-guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("route-guards"));
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = project();
  seed(p, [
    card("tree-one", "Tree one"),
    card("one-open", "Open in tree one", { parent: "tree-one" }),
    card("tree-two", "Tree two"),
    card("two-open", "Open in tree two", { parent: "tree-two" }),
    card("auth-flow", "Auth flow", { parent: "tree-two" }),
    decided("tree-one"),
    decided("tree-two"),
    decided("auth-flow"),
  ]);
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected", "--why", "the flow is wrong"]);
  const ids = outLines((await ok(p, ["find"])).out).map((l) => l.split("  ")[0]);
  expect(ids).toContain("one-open");
  expect(ids).toContain("two-open");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree-one");
  expect(ids).not.toContain("tree-two");
});
