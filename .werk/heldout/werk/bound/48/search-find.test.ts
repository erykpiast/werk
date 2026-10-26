import { expect, test } from "bun:test";
import { card, edge, ghost, lines, setupWerk } from "./support.ts";

const { werk, seed } = setupWerk();

test("09.1 search with no term lists the decided cards only", async () => {
  seed(
    card("d1", { title: "Decided one", status: "decided" }),
    card("d2", { title: "Decided two", status: "decided" }),
    card("d3", { title: "Decided three", status: "decided" }),
    card("o1", { title: "Open one" }),
    ghost("g1", { title: "Ghost one", status: "decided" }),
  );
  const r = await werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 search with two terms ranks by hits and skips removed cards", async () => {
  seed(
    card("cache-layout", {
      title: "Cache layout",
      status: "decided",
      body: "Cache eviction\n\neviction policy",
    }),
    card("eviction-timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    card("cache-size", { title: "Cache size", status: "decided" }),
    card("gone", { title: "Gone", body: "cache eviction" }),
    [{ type: "node.removed", id: "gone" }],
  );
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 search finds a word in a rejected option and narrows with --under and --status", async () => {
  seed(
    card("parent-topic", { title: "Parent topic", status: "decided" }),
    card("storage-format", {
      title: "Storage format",
      status: "decided",
      parent: "parent-topic",
    }),
    card("storage-format:opt0", {
      kind: "option",
      title: "Embedded database",
      why: "SQLite needs a native build",
    }),
    edge("storage-format:opt0", "storage-format", "alternative_to"),
    card("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" }),
  );
  const all = await werk("search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toMatch(/Storage format/);
  expect(lines(all.stdout).find((l) => l.includes("storage-format"))).toContain("decided");
  expect(all.stdout).toContain("Elsewhere");
  const under = await werk("search", "sqlite", "--under", "parent-topic");
  expect(under.code).toBe(0);
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const decided = await werk("search", "sqlite", "--status", "decided");
  expect(decided.code).toBe(0);
  expect(lines(decided.stdout)).toHaveLength(1);
  expect(decided.stdout).toContain("Storage format");
});

const at = "2026-10-10T09:00:00.000Z";

test("09.4 find lists the open work under one card", async () => {
  seed(
    card("client", { title: "Client", status: "decided" }),
    card("routing", { title: "Routing", parent: "client" }),
    card("theme", { title: "Theme", status: "proto", parent: "client" }),
    card("route-guards", { title: "Route guards", parent: "routing" }),
    // a paused card: depends on a card that is postponed
    card("postponed-card", { title: "Postponed card", status: "decided", parent: "client" }),
    card("paused-card", { title: "Paused card", parent: "client" }),
    edge("paused-card", "postponed-card", "depends_on", "needs it"),
    [{ type: "node.reopened", id: "postponed-card", reason: "postponed", at }],
    // a stale card: depends on a card that was reopened as invalidated
    card("basis", { title: "Basis", status: "decided" }),
    card("stale-card", { title: "Stale card", parent: "client" }),
    edge("stale-card", "basis", "depends_on", "needs it"),
    [{ type: "node.reopened", id: "basis", reason: "invalidated", at }],
    card("routing:opt0", { kind: "option", title: "Option card", why: "no" }),
    edge("routing:opt0", "routing", "alternative_to"),
    card("src1", { kind: "source", title: "Source card" }),
    edge("routing", "src1", "supported_by"),
    card("billing", { title: "Billing" }),
  );
  const r = await werk("find", "routing");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out[0]).toContain("Routing");
  expect(out[1]).toContain("Route guards");
  for (const hidden of ["Billing", "Option card", "Source card"]) {
    expect(r.stdout).not.toContain(hidden);
  }
  const c = await werk("find", "client");
  expect(c.code).toBe(0);
  const text = c.stdout;
  expect(text).toContain("Routing");
  expect(text).toContain("Theme");
  expect(text.indexOf("Routing")).toBeLessThan(text.indexOf("Route guards"));
  expect(text.indexOf("Theme")).toBeLessThan(text.indexOf("Route guards"));
  expect(lines(text).some((l) => l.startsWith("client "))).toBe(false);
  expect(text).not.toContain("Paused card");
  expect(text).not.toContain("Stale card");
  expect(text).not.toContain("Postponed card");
});

test("09.5 find with no id lists open work from every tree and a card reopened as rejected", async () => {
  seed(
    card("r1", { title: "Root one", status: "decided" }),
    card("open-one", { title: "Open one", parent: "r1" }),
    card("r2", { title: "Root two", status: "decided" }),
    card("open-two", { title: "Open two", parent: "r2" }),
    card("auth-flow", { title: "Auth flow", status: "decided", parent: "r1" }),
    [{ type: "node.reopened", id: "auth-flow", reason: "rejected", at }],
  );
  const r = await werk("find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Open one");
  expect(r.stdout).toContain("Open two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
