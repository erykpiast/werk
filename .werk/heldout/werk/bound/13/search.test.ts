// Held-out steps 09.x: search and find.
import { expect, test } from "bun:test";
import { card, project } from "./helpers.ts";

const outLines = (out: string) => out.split("\n").filter((line) => line !== "");
const ids = (out: string) => outLines(out).map((line) => line.split(/\s+/)[0]);

test("09.1 an agent lists the index of decided cards", async () => {
  const p = project();
  p.seed(
    card("root", "Root of the map", { status: "decided" }),
    card("pricing", "Pricing is per seat", { status: "decided", parent: "root" }),
    card("tax", "Tax is per region", { status: "decided", parent: "root" }),
    card("trial", "A trial is free", { parent: "root" }),
    {
      type: "node.proposed",
      actor: "agent",
      payload: { id: "ghosted", kind: "card", title: "A ghost card", parent: "root" },
    },
    { type: "node.decided", payload: { id: "ghosted" } },
  );
  const out = await p.ok("search");
  expect(outLines(out)).toEqual(["root  Root of the map", "pricing  Pricing is per seat", "tax  Tax is per region"]);
  expect(out).not.toContain("trial");
  expect(out).not.toContain("ghosted");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const p = project();
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("cache-layout", "Cache layout", {
      status: "decided",
      parent: "root",
      body: "Cache eviction runs on a timer. The eviction policy is LRU.",
    }),
    card("eviction-timer", "Eviction timer", {
      parent: "root",
      why: "The eviction must run often.",
      body: "A CACHE warmup runs first.",
    }),
    card("cache-size", "Cache size", { status: "decided", parent: "root", body: "The cache holds 1000 entries." }),
    card("old-cache", "Old cache eviction", { status: "decided", parent: "root", body: "cache eviction" }),
    { type: "node.removed", payload: { id: "old-cache" } },
  );
  const out = await p.ok("search", "cache", "eviction");
  expect(outLines(out)).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
  expect(out).not.toContain("cache-size");
  expect(out).not.toContain("old-cache");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const p = project();
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("parent-topic", "Parent topic", { status: "decided", parent: "root" }),
    card("storage-format", "Storage format", { status: "decided", parent: "parent-topic", body: "One JSON file." }),
    {
      type: "node.added",
      payload: {
        id: "storage-format:opt0",
        kind: "option",
        title: "A database file",
        why_not: "SQLite needs a native build",
      },
    },
    { type: "edge.added", payload: { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" } },
    card("elsewhere", "Elsewhere", { parent: "root", body: "Try sqlite for the cache." }),
  );
  // The open card's body is the one place outside the option that says sqlite; it is outside the subtree.
  expect(ids(await p.ok("search", "sqlite"))).toEqual(expect.arrayContaining(["storage-format", "elsewhere"]));
  expect(await p.ok("search", "sqlite")).toMatch(/^storage-format\s+decided\s+Storage format$/m);
  expect(ids(await p.ok("search", "sqlite", "--under", "parent-topic"))).toEqual(["storage-format"]);
  expect(ids(await p.ok("search", "sqlite", "--status", "decided"))).toEqual(["storage-format"]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const p = project();
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("client", "Client", { status: "decided", parent: "root" }),
    card("routing", "Routing", { parent: "client" }),
    card("theme", "Theme", { status: "proto", parent: "client" }),
    card("route-guards", "Route guards", { parent: "routing" }),
    // A basis outside the subtree, decided, that the stale card depends on.
    card("basis", "Basis", { status: "decided", parent: "root" }),
    card("postponed", "Postponed card", { status: "decided", parent: "client" }),
    card("paused", "Paused card", { parent: "client" }),
    card("stale", "Stale card", { parent: "client" }),
    { type: "edge.added", payload: { from: "paused", to: "postponed", type: "depends_on", why: "needs it" } },
    { type: "edge.added", payload: { from: "stale", to: "basis", type: "depends_on", why: "needs it" } },
    { type: "node.reopened", payload: { id: "postponed", reason: "postponed" } },
    { type: "node.reopened", payload: { id: "basis", reason: "invalidated" } },
    { type: "node.added", payload: { id: "routing:opt0", kind: "option", title: "Routing option", why_not: "no" } },
    { type: "edge.added", payload: { from: "routing:opt0", to: "routing", type: "alternative_to" } },
    { type: "node.added", payload: { id: "src-routing", kind: "source", title: "Routing source", url: "https://x.y" } },
    { type: "edge.added", payload: { from: "routing", to: "src-routing", type: "supported_by" } },
    card("billing-tree", "Billing tree", { status: "decided" }),
    card("billing", "Billing", { parent: "billing-tree" }),
  );
  // The marks the step names are on the cards.
  expect(await p.ok("stale", "--kind", "paused")).toContain("paused");
  expect(await p.ok("stale", "--kind", "stale")).toContain("stale");

  const routing = ids(await p.ok("find", "routing"));
  expect(routing).toEqual(["routing", "route-guards"]);
  for (const hidden of ["billing", "routing:opt0", "src-routing"]) expect(routing).not.toContain(hidden);

  const client = ids(await p.ok("find", "client"));
  expect(client.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(client.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("route-guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("route-guards"));
  for (const hidden of ["client", "paused", "stale", "postponed"]) expect(client).not.toContain(hidden);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = project();
  p.seed(
    card("tree-a", "Tree A", { status: "decided" }),
    card("work-a", "Work A", { parent: "tree-a" }),
    card("tree-b", "Tree B", { status: "decided" }),
    card("work-b", "Work B", { parent: "tree-b" }),
    card("auth-flow", "Auth flow", { status: "decided", parent: "tree-a" }),
    { type: "node.reopened", payload: { id: "auth-flow", reason: "rejected" } },
  );
  const found = await p.ok("find");
  const list = ids(found);
  expect(list).toEqual(expect.arrayContaining(["work-a", "work-b", "auth-flow"]));
  for (const line of outLines(found)) expect(line).not.toMatch(/\sdecided\s/);
  expect(list).not.toContain("tree-a");
  expect(list).not.toContain("tree-b");
});
