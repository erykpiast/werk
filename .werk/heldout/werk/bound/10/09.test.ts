// werk/09: an agent lists, searches and finds cards with `werk search` and `werk find`.
import { expect, test } from "bun:test";
import { card, link, useWerk } from "./support.ts";

const w = useWerk();
const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");
const ghost = (id: string, title: string, status = "open", extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title,
  status,
  ...extra,
});

test("09.1 an agent lists the index of decided cards", async () => {
  w.seed(
    ...card("alpha", { status: "decided", title: "Alpha title" }),
    ...card("beta", { status: "decided", title: "Beta title" }),
    ...card("gamma", { status: "decided", title: "Gamma title" }),
    ...card("pending", { status: "open", title: "Pending title" }),
    ghost("phantom", "Phantom title", "decided"),
  );
  const result = await w.run("search");
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  const out = lines(result.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [["alpha", "Alpha title"], ["beta", "Beta title"], ["gamma", "Gamma title"]] as const) {
    expect(out.some((l) => l.includes(id) && l.includes(title))).toBe(true);
  }
  expect(result.stdout).not.toContain("Pending title");
  expect(result.stdout).not.toContain("Phantom title");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  w.seed(
    ...card("cache-layout", { status: "decided", title: "Cache layout", body: "Cache eviction happens by the eviction policy." }),
    ...card("eviction-timer", { status: "open", title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    ...card("cache-size", { status: "decided", title: "Cache size", body: "How big the cache is." }),
    ...card("old-note", { status: "open", title: "Old note", body: "cache eviction" }),
    { type: "node.removed", id: "old-note" },
  );
  const result = await w.run("search", "cache", "eviction");
  expect(result.code).toBe(0);
  const out = lines(result.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(result.stdout).not.toContain("Cache size");
  expect(result.stdout).not.toContain("Old note");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  w.seed(
    ...card("parent-topic", { status: "decided", title: "Parent topic" }),
    ...card("storage-format", { status: "decided", title: "Storage format", parent: "parent-topic" }),
    { type: "node.proposed", id: "storage-format:opt0", kind: "option", title: "A database file", why: "SQLite needs a native build", status: "open" },
    { type: "node.accepted", id: "storage-format:opt0", actor: "you" },
    link("storage-format:opt0", "storage-format", "alternative_to"),
    ...card("elsewhere", { status: "open", title: "Elsewhere", body: "we could use sqlite here" }),
  );
  const all = await w.run("search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toMatch(/storage-format.*decided/);
  expect(all.stdout).toContain("elsewhere");
  const under = await w.run("search", "sqlite", "--under", "parent-topic");
  expect(under.code).toBe(0);
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("storage-format");
  const decided = await w.run("search", "sqlite", "--status", "decided");
  expect(decided.code).toBe(0);
  expect(lines(decided.stdout)).toHaveLength(1);
  expect(decided.stdout).toContain("storage-format");
});

/** A map for the find steps. */
function clientMap() {
  w.seed(
    ...card("client", { status: "decided", title: "Client" }),
    ...card("routing", { parent: "client", title: "Routing" }),
    ...card("theme", { parent: "client", status: "proto", title: "Theme" }),
    ...card("route-guards", { parent: "routing", title: "Route guards" }),
    { type: "node.proposed", id: "routing:opt0", kind: "option", title: "Hash routes", why: "ugly", status: "open" },
    { type: "node.accepted", id: "routing:opt0", actor: "you" },
    link("routing:opt0", "routing", "alternative_to"),
    { type: "node.proposed", id: "spec-doc", kind: "source", title: "Router docs", status: "open" },
    { type: "node.accepted", id: "spec-doc", actor: "you" },
    link("routing", "spec-doc", "supported_by"),
    ...card("billing", { title: "Billing" }),
    // postponed: a decided card under the client, reopened as postponed
    ...card("later", { parent: "client", status: "decided", title: "Later card" }),
    ...card("waits", { parent: "client", title: "Waits card" }),
    link("waits", "later", "depends_on"),
    { type: "node.reopened", id: "later", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    // stale: an open card under the client that depends on a card that was reopened
    ...card("basis", { parent: "billing", status: "decided", title: "Basis" }),
    ...card("leans", { parent: "client", title: "Leans card" }),
    link("leans", "basis", "depends_on"),
    { type: "node.reopened", id: "basis", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
}

test("09.4 an agent finds the open work under one card", async () => {
  clientMap();
  const routing = await w.run("find", "routing");
  expect(routing.code).toBe(0);
  const out = lines(routing.stdout);
  expect(out[0]).toContain("routing");
  expect(out[1]).toContain("route-guards");
  expect(routing.stdout).not.toContain("Billing");
  expect(routing.stdout).not.toContain("Hash routes");
  expect(routing.stdout).not.toContain("Router docs");
  const client = await w.run("find", "client");
  expect(client.code).toBe(0);
  const text = client.stdout;
  expect(text.indexOf("Routing")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("Theme")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("Route guards")).toBeGreaterThan(Math.max(text.indexOf("Routing"), text.indexOf("Theme")));
  expect(text).not.toMatch(/^\S*client\b.*Client$/m);
  expect(text).not.toContain("Later card");
  expect(text).not.toContain("Waits card");
  expect(text).not.toContain("Leans card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  w.seed(
    ...card("one", { title: "Tree one" }),
    ...card("two", { title: "Tree two" }),
    ...card("auth-flow", { status: "decided", title: "Auth flow", parent: "one" }),
    { type: "node.reopened", id: "auth-flow", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const result = await w.run("find");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Tree one");
  expect(result.stdout).toContain("Tree two");
  expect(result.stdout).toContain("Auth flow");
  expect(result.stdout).not.toMatch(/\bdecided\b/);
});
