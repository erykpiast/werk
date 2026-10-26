// Scenarios 09.x: search and find.
import { expect, test } from "bun:test";
import { card, decided, link, ok, type Seed, withMap } from "./helpers.ts";

const outLines = (out: string) => out.split("\n").filter((l) => l !== "");
const idOf = (line: string) => line.split(/\s+/)[0];

test("09.1 an agent lists the index of decided cards", async () => {
  const p = withMap([
    card("root", "Root"),
    decided("root"),
    card("alpha", "Alpha rule", "root"),
    decided("alpha"),
    card("beta", "Beta rule", "root"),
    decided("beta"),
    card("gamma", "Gamma question", "root"),
    ["node.proposed", { id: "delta", kind: "card", title: "Delta ghost", parent: "root", status: "decided" }],
  ]);
  const out = (await ok(p, ["search"])).out;
  const rows = outLines(out);
  expect(rows).toHaveLength(3);
  expect(rows).toContain("root  Root");
  expect(rows).toContain("alpha  Alpha rule");
  expect(rows).toContain("beta  Beta rule");
  expect(out).not.toContain("gamma");
  expect(out).not.toContain("delta");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = withMap([
    card("root", "Root"),
    card("cache-layout", "Cache layout", "root", { body: "Cache eviction follows the eviction policy." }),
    decided("cache-layout"),
    card("eviction-timer", "Eviction timer", "root", { why: "A timer drives eviction.", body: "It runs after CACHE warmup." }),
    card("cache-size", "Cache size", "root", { body: "The cache holds 1 GB." }),
    decided("cache-size"),
    card("old-cache", "Old cache eviction", "root"),
    ["node.removed", { id: "old-cache" }],
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  const rows = outLines(out);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toBe("cache-layout  decided  Cache layout");
  expect(rows[1]).toBe("eviction-timer  open  Eviction timer");
  expect(out).not.toContain("cache-size");
  expect(out).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = withMap([
    card("root", "Root"),
    card("parent-topic", "Parent topic", "root"),
    decided("parent-topic"),
    card("storage-format", "Storage format", "parent-topic", { body: "The log is JSON lines." }),
    ["node.added", { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" }],
    link("storage-format:opt0", "storage-format", "alternative_to"),
    decided("storage-format"),
    card("elsewhere", "Embedded store", "root", { body: "Try sqlite for the cache." }),
  ]);
  const all = outLines((await ok(p, ["search", "sqlite"])).out);
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all.map(idOf)).toContain("elsewhere");
  const under = outLines((await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out);
  expect(under.map(idOf)).toEqual(["storage-format"]);
  const dec = outLines((await ok(p, ["search", "sqlite", "--status", "decided"])).out);
  expect(dec.map(idOf)).toEqual(["storage-format"]);
});

function clientMap(): Seed[] {
  return [
    card("client", "Client"),
    decided("client"),
    card("routing", "Routing", "client"),
    card("theme", "Theme", "client", { status: "proto" }),
    card("route-guards", "Route guards", "routing"),
    card("paused-card", "Paused card", "client"),
    card("stale-card", "Stale card", "client"),
    card("postponed-card", "Postponed card", "client"),
    decided("postponed-card"),
    card("infra", "Infra"),
    card("infra-a", "Infra A", "infra"),
    decided("infra-a"),
    card("infra-b", "Infra B", "infra"),
    decided("infra-b"),
    link("paused-card", "infra-a", "depends_on", "Paused card runs on Infra A"),
    link("stale-card", "infra-b", "depends_on", "Stale card runs on Infra B"),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "Ugly URLs" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "src-router", kind: "source", title: "Router docs", url: "https://example.com" }],
    link("routing", "src-router", "supported_by"),
    card("billing-tree", "Billing tree"),
    card("billing", "Billing", "billing-tree"),
  ];
}

test("09.4 an agent finds the open work under one card", async () => {
  const p = withMap(clientMap());
  await ok(p, ["reopen", "postponed-card", "--reason", "postponed"]);
  await ok(p, ["reopen", "infra-a", "--reason", "postponed"]);
  await ok(p, ["reopen", "infra-b", "--reason", "invalidated"]);

  const routing = outLines((await ok(p, ["find", "routing"])).out).map(idOf);
  expect(routing).toEqual(["routing", "route-guards"]);
  const client = outLines((await ok(p, ["find", "client"])).out).map(idOf);
  expect(client).toContain("routing");
  expect(client).toContain("theme");
  expect(client).toContain("route-guards");
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("route-guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("route-guards"));
  for (const id of ["client", "paused-card", "stale-card", "postponed-card", "billing", "routing:opt0", "src-router"])
    expect(client).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = withMap([
    card("tree-a", "Tree A"),
    decided("tree-a"),
    card("open-a", "Open A", "tree-a"),
    card("tree-b", "Tree B"),
    decided("tree-b"),
    card("open-b", "Open B", "tree-b"),
    card("auth-flow", "Auth flow", "tree-b"),
    decided("auth-flow"),
  ]);
  await ok(p, ["reopen", "auth-flow", "--reason", "rejected"]);
  const ids = outLines((await ok(p, ["find"])).out).map(idOf);
  expect(ids).toContain("open-a");
  expect(ids).toContain("open-b");
  expect(ids).toContain("auth-flow");
  expect(ids).not.toContain("tree-a");
  expect(ids).not.toContain("tree-b");
});
