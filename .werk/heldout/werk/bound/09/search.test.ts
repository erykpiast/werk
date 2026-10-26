import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendRaw,
  createProject,
  decide,
  must,
  type Project,
  real,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const run = async (...args: string[]) => {
  const r = await werk(p, ...args);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return lines(r.stdout);
};

test("09.1 an agent lists the index of decided cards", async () => {
  await decide(p, "d1", { title: "First decided" });
  await decide(p, "d2", { title: "Second decided", parent: "d1" });
  await decide(p, "d3", { title: "Third decided", parent: "d1" });
  await real(p, "o1", { title: "Still open", parent: "d1" });
  // A ghost that carries the status decided: the add verb refuses it, the log accepts it.
  appendRaw(p, {
    type: "node.proposed",
    id: "g1",
    kind: "card",
    title: "Ghost that was decided",
    status: "decided",
  });

  const out = await run("search");
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "First decided"],
    ["d2", "Second decided"],
    ["d3", "Third decided"],
  ]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(out.join("\n")).not.toContain("Still open");
  expect(out.join("\n")).not.toContain("Ghost that was decided");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  await decide(p, "cache-layout", {
    title: "Cache layout",
    body: "Cache eviction happens per shard. The eviction policy is LRU.",
  });
  await real(p, "eviction-timer", {
    title: "Eviction timer",
    why: "eviction needs a clock",
    body: "CACHE warmup runs first",
  });
  await decide(p, "cache-size", { title: "Cache size", body: "cache fits in memory" });
  await real(p, "gone", { title: "Gone", body: "cache eviction" });
  await must(p, "remove", "gone");

  const out = await run("search", "cache", "eviction");
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  const all = out.join("\n");
  expect(all).not.toContain("cache-size");
  expect(all).not.toContain("gone");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  await decide(p, "parent-topic", { title: "Parent topic" });
  await decide(p, "storage-format", { title: "Storage format", parent: "parent-topic" });
  await real(p, "storage-format:opt0", { title: "Embedded database" });
  // The option is a real card of kind option; its why-not carries the word.
  appendRaw(p, {
    type: "node.proposed",
    id: "storage-format:opt1",
    kind: "option",
    title: "A database file",
    status: "open",
    why: "SQLite needs a native build",
  });
  await must(p, "link", "storage-format:opt1", "storage-format", "--type", "alternative_to");
  await must(p, "accept", "storage-format:opt1", "--actor", "you");
  await real(p, "elsewhere", { title: "Elsewhere", body: "we could use sqlite here" });

  const all = await run("search", "sqlite");
  expect(all.some((l) => l.includes("storage-format") && l.includes("decided"))).toBe(true);
  expect(all.some((l) => l.includes("elsewhere"))).toBe(true);

  const under = await run("search", "sqlite", "--under", "parent-topic");
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("storage-format");

  const decided = await run("search", "sqlite", "--status", "decided");
  expect(decided).toHaveLength(1);
  expect(decided[0]).toContain("storage-format");
});

test("09.4 an agent finds the open work under one card", async () => {
  await decide(p, "client", { title: "Client" });
  await real(p, "routing", { title: "Routing", parent: "client" });
  await real(p, "theme", { title: "Theme", parent: "client", status: "proto" });
  await real(p, "route-guards", { title: "Route guards", parent: "routing" });
  // The log has no event that sets a paused, stale or postponed mark, so these three carry
  // the marks' names only. See the binder note.
  await real(p, "paused-card", { title: "Paused card", parent: "client" });
  await real(p, "stale-card", { title: "Stale card", parent: "client" });
  await real(p, "postponed-card", { title: "Postponed card", parent: "client" });
  await must(p, "add", "routing:opt0", "--kind", "option", "--title", "An option");
  await must(p, "link", "routing:opt0", "routing", "--type", "alternative_to");
  await must(p, "add", "routing-src", "--kind", "source", "--title", "A source");
  await must(p, "link", "routing", "routing-src", "--type", "supported_by");
  await real(p, "billing", { title: "Billing" });

  const routing = await run("find", "routing");
  const ri = routing.findIndex((l) => l.includes("Routing"));
  const gi = routing.findIndex((l) => l.includes("Route guards"));
  expect(ri).toBeGreaterThanOrEqual(0);
  expect(gi).toBeGreaterThan(ri);
  const text = routing.join("\n");
  expect(text).not.toContain("Billing");
  expect(text).not.toContain("An option");
  expect(text).not.toContain("A source");

  const client = await run("find", "client");
  const idx = (t: string) => client.findIndex((l) => l.includes(t));
  expect(idx("Routing")).toBeGreaterThanOrEqual(0);
  expect(idx("Theme")).toBeGreaterThanOrEqual(0);
  expect(idx("Route guards")).toBeGreaterThan(idx("Routing"));
  expect(idx("Route guards")).toBeGreaterThan(idx("Theme"));
  expect(client.some((l) => /\bClient\b/.test(l) && !l.includes("Route"))).toBe(false);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  await real(p, "tree-a", { title: "Tree A open card" });
  await real(p, "tree-b", { title: "Tree B open card" });
  await decide(p, "auth-flow", { title: "Auth flow" });
  // There is no verb that reopens a card as rejected.
  const reopen = await werk(p, "reopen", "auth-flow", "--status", "rejected", "--actor", "you");
  expect(reopen.stderr).toBe("");
  expect(reopen.code).toBe(0);

  const out = (await run("find")).join("\n");
  expect(out).toContain("Tree A open card");
  expect(out).toContain("Tree B open card");
  expect(out).toContain("Auth flow");
});
