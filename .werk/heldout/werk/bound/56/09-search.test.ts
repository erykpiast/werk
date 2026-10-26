import { expect, test } from "bun:test";
import { card, held } from "./helpers.ts";

const lines = (out: string) => out.split("\n").filter((line) => line.trim() !== "");
const ids = (out: string) => lines(out).map((line) => line.trim().split(/\s+/)[0]);

test("09.1 an agent lists the index of decided cards", async () => {
  const h = held();
  card(h, "d-one", "Decided one", {}, true);
  card(h, "d-two", "Decided two", {}, true);
  card(h, "d-three", "Decided three", {}, true);
  card(h, "open-one", "Open one");
  h.seed("node.proposed", { id: "ghost-one", kind: "card", title: "Ghost one" }, "agent");
  h.seed("node.decided", { id: "ghost-one" });

  const run = await h.w("search");
  expect(run.code).toBe(0);
  expect(lines(run.out).length).toBe(3);
  for (const [id, title] of [
    ["d-one", "Decided one"],
    ["d-two", "Decided two"],
    ["d-three", "Decided three"],
  ]) {
    expect(lines(run.out).some((line) => line.includes(id as string) && line.includes(title as string))).toBe(true);
  }
  expect(run.out).not.toContain("open-one");
  expect(run.out).not.toContain("ghost-one");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  const h = held();
  card(h, "cache-layout", "Cache layout", { body: "Cache eviction runs first. The eviction policy is LRU." }, true);
  card(h, "eviction-timer", "Eviction timer", { why: "The eviction must run on time.", body: "CACHE warmup." });
  card(h, "cache-size", "Cache size", { body: "The cache holds 100 entries." }, true);
  card(h, "gone-card", "Gone card", { body: "cache eviction" }, true);
  h.seed("node.removed", { id: "gone-card" });

  const run = await h.w("search", "cache", "eviction");
  expect(run.code).toBe(0);
  const out = lines(run.out);
  expect(out.length).toBe(2);
  expect(out[0]).toMatch(/^cache-layout\s+decided\s+Cache layout$/);
  expect(out[1]).toMatch(/^eviction-timer\s+open\s+Eviction timer$/);
  expect(run.out).not.toContain("cache-size");
  expect(run.out).not.toContain("gone-card");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  const h = held();
  card(h, "parent-topic", "Parent topic", {}, true);
  card(h, "storage-format", "Storage format", { parent: "parent-topic", body: "One JSON line per event." }, true);
  h.seed("node.added", {
    id: "storage-format:opt0",
    kind: "option",
    title: "A database file",
    why_not: "SQLite needs a native build",
  });
  h.seed("edge.added", { from: "storage-format:opt0", to: "storage-format", type: "alternative_to" });
  card(h, "elsewhere", "Elsewhere", { body: "Try sqlite for the cache." });

  const all = await h.w("search", "sqlite");
  expect(all.out).toMatch(/^storage-format\s+decided\s+Storage format$/m);
  expect(all.out).toMatch(/^elsewhere\s+open\s+Elsewhere$/m);

  const under = await h.w("search", "sqlite", "--under", "parent-topic");
  expect(ids(under.out)).toEqual(["storage-format"]);
  const decided = await h.w("search", "sqlite", "--status", "decided");
  expect(ids(decided.out)).toEqual(["storage-format"]);
});

test("09.4 an agent finds the open work under one card", async () => {
  const h = held();
  card(h, "client", "Client", {}, true);
  card(h, "routing", "Routing", { parent: "client" });
  h.seed("node.added", { id: "theme", kind: "card", title: "Theme", parent: "client", status: "proto" });
  card(h, "route-guards", "Route guards", { parent: "routing" });
  // The postponed card: decided, then reopened as postponed, which pauses the card that depends on it.
  card(h, "postponed-card", "Postponed card", { parent: "client" }, true);
  card(h, "paused-card", "Paused card", { parent: "client" });
  h.seed("edge.added", {
    from: "paused-card",
    to: "postponed-card",
    type: "depends_on",
    why: "it needs the postponed card",
  });
  // The stale card: depends on a decided card elsewhere that is then reopened as invalidated.
  card(h, "other-root", "Other root", {}, true);
  card(h, "basis", "Basis", { parent: "other-root" }, true);
  card(h, "stale-card", "Stale card", { parent: "client" });
  h.seed("edge.added", { from: "stale-card", to: "basis", type: "depends_on", why: "it needs the basis" });
  h.seed("node.reopened", { id: "postponed-card", reason: "postponed" });
  h.seed("node.reopened", { id: "basis", reason: "invalidated" });
  h.seed("node.added", { id: "routing:opt0", kind: "option", title: "Routing option", why_not: "no" });
  h.seed("edge.added", { from: "routing:opt0", to: "routing", type: "alternative_to" });
  h.seed("node.added", { id: "routing-src", kind: "source", title: "Routing source", url: "https://example.invalid" });
  h.seed("edge.added", { from: "routing", to: "routing-src", type: "supported_by" });
  card(h, "billing-root", "Billing root", {}, true);
  card(h, "billing", "Billing", { parent: "billing-root" });

  // The marks the Given names are in place.
  const stale = await h.w("stale");
  expect(stale.out).toMatch(/paused\s+paused-card/);
  expect(stale.out).toMatch(/stale\s+stale-card/);

  const routing = await h.w("find", "routing");
  expect(ids(routing.out)).toEqual(["routing", "route-guards"]);
  for (const id of ["billing", "routing:opt0", "routing-src"]) expect(routing.out).not.toContain(id);

  const client = await h.w("find", "client");
  const found = ids(client.out);
  expect(found).toContain("routing");
  expect(found).toContain("theme");
  expect(found).toContain("route-guards");
  expect(found.indexOf("route-guards")).toBeGreaterThan(found.indexOf("routing"));
  expect(found.indexOf("route-guards")).toBeGreaterThan(found.indexOf("theme"));
  expect(found).not.toContain("client");
  for (const id of ["paused-card", "stale-card", "postponed-card"]) expect(found).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const h = held();
  card(h, "tree-a", "Tree A", {}, true);
  card(h, "work-a", "Work A", { parent: "tree-a" });
  card(h, "tree-b", "Tree B", {}, true);
  card(h, "work-b", "Work B", { parent: "tree-b" });
  card(h, "auth-flow", "Auth flow", { parent: "tree-a" }, true);
  h.seed("node.reopened", { id: "auth-flow", reason: "rejected" });

  const run = await h.w("find");
  expect(run.code).toBe(0);
  const found = ids(run.out);
  expect(found).toContain("work-a");
  expect(found).toContain("work-b");
  expect(found).toContain("auth-flow");
  expect(found).not.toContain("tree-a");
  expect(found).not.toContain("tree-b");
});
