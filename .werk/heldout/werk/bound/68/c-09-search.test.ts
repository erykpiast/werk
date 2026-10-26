import { expect, test } from "bun:test";
import { card, decided, ghost, link, ok, seeded } from "./c-helpers.ts";

const T = 60_000;

const rows = (out: string) => out.split("\n").filter((l) => l.trim() !== "");
const idsOf = (out: string) => rows(out).map((l) => l.trim().split(/\s+/)[0]?.replace(/^#/, ""));

test(
  "09.1 search with no term lists the decided cards only",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("d1", "First decided", "root"),
      decided("d2", "Second decided", "root"),
      card("o1", "An open card", "root"),
      ghost("g1", "A ghost decided card", "root", { status: "decided", who: "me" }),
    ]);
    const out = await ok(p, "search");
    // root is itself decided; the step's three decided cards are root, d1 and d2.
    const lines = rows(out);
    expect(lines).toHaveLength(3);
    for (const [id, title] of [
      ["root", "Root"],
      ["d1", "First decided"],
      ["d2", "Second decided"],
    ]) {
      const line = lines.find((l) => l.includes(`${id} `));
      expect(line, id).toBeDefined();
      expect(line).toContain(title as string);
    }
    expect(out).not.toContain("o1");
    expect(out).not.toContain("g1");
  },
  T,
);

test(
  "09.2 two terms, best match first",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("cache-layout", "Cache layout", "root", {
        body: "Cache eviction runs hourly. The eviction policy is LRU.",
      }),
      card("eviction-timer", "Eviction timer", "root", { why: "eviction must run", body: "CACHE warmup first." }),
      decided("cache-size", "Cache size", "root", { body: "The cache holds 1 GB." }),
      card("old-cache", "Old card", "root", { body: "cache eviction" }),
    ]);
    await ok(p, "remove", "old-cache", "--actor", "you");
    const out = await ok(p, "search", "cache", "eviction");
    const lines = rows(out);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("cache-layout");
    expect(lines[0]).toContain("decided");
    expect(lines[0]).toContain("Cache layout");
    expect(lines[1]).toContain("eviction-timer");
    expect(lines[1]).toContain("open");
    expect(lines[1]).toContain("Eviction timer");
    expect(out).not.toContain("cache-size");
    expect(out).not.toContain("old-cache");
  },
  T,
);

test(
  "09.3 a word in a rejected option finds the card, and the flags narrow",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("parent-topic", "Parent topic", "root"),
      decided("storage-format", "Storage format", "parent-topic", { body: "We store JSON lines." }),
      [
        "node.added",
        { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
      ],
      link("storage-format:opt0", "storage-format", "alternative_to"),
      card("outside", "Outside card", "root", { body: "maybe sqlite later" }),
    ]);
    const all = await ok(p, "search", "sqlite");
    const sf = rows(all).find((l) => l.includes("storage-format"));
    expect(sf, all).toBeDefined();
    expect(sf).toContain("decided");
    expect(all).toContain("outside");
    const under = await ok(p, "search", "sqlite", "--under", "parent-topic");
    expect(idsOf(under)).toEqual(["storage-format"]);
    const dec = await ok(p, "search", "sqlite", "--status", "decided");
    expect(idsOf(dec)).toEqual(["storage-format"]);
  },
  T,
);

test(
  "09.4 find lists the open work under one card",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      decided("client", "Client", "root"),
      card("routing", "Routing", "client"),
      card("theme", "Theme", "client", { status: "proto" }),
      card("route-guards", "Route guards", "routing"),
      decided("engine", "Engine", "root"),
      decided("format", "Format", "root"),
      card("paused-card", "Paused card", "client"),
      card("stale-card", "Stale card", "client"),
      decided("postponed-card", "Postponed card", "client"),
      link("paused-card", "engine", "depends_on", "w"),
      link("stale-card", "format", "depends_on", "w"),
      ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "ugly" }],
      link("routing:opt0", "routing", "alternative_to"),
      ["node.added", { id: "routing-src", kind: "source", title: "Router docs", url: "https://example.com" }],
      link("routing", "routing-src", "supported_by"),
      card("billing", "Billing", "root"),
    ]);
    await ok(p, "reopen", "engine", "--reason", "postponed");
    await ok(p, "reopen", "format", "--reason", "rejected");
    await ok(p, "reopen", "postponed-card", "--reason", "postponed");
    const r = idsOf(await ok(p, "find", "routing"));
    expect(r).toEqual(["routing", "route-guards"]);
    const c = idsOf(await ok(p, "find", "client"));
    expect(c).toContain("routing");
    expect(c).toContain("theme");
    expect(c).toContain("route-guards");
    expect(c.indexOf("routing")).toBeLessThan(c.indexOf("route-guards"));
    expect(c.indexOf("theme")).toBeLessThan(c.indexOf("route-guards"));
    for (const id of ["client", "paused-card", "stale-card", "postponed-card", "billing"]) expect(c).not.toContain(id);
  },
  T,
);

test(
  "09.5 a card reopened as rejected comes back as work in every tree",
  async () => {
    const p = seeded([
      decided("root", "Root"),
      card("open-a", "Open in tree one", "root"),
      decided("other", "Other tree"),
      card("open-b", "Open in tree two", "other"),
      decided("auth-flow", "Auth flow", "root"),
    ]);
    await ok(p, "reopen", "auth-flow", "--reason", "rejected");
    const out = await ok(p, "find");
    const ids = idsOf(out);
    expect(ids).toContain("open-a");
    expect(ids).toContain("open-b");
    expect(ids).toContain("auth-flow");
    for (const id of ["root", "other"]) expect(ids).not.toContain(id);
  },
  T,
);
