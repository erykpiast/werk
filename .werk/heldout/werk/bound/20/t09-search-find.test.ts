import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import {
  decided,
  decidedGhost,
  edge,
  ghost,
  lines,
  real,
  seed,
  werk,
} from "./helpers.ts";

const project = useProject();

test("09.1 search with no term lists the decided cards only", async () => {
  const p = project();
  seed(
    p,
    decided("alpha", { title: "Alpha decision" }),
    decided("beta", { title: "Beta decision" }),
    decided("gamma", { title: "Gamma decision" }),
    real("open-one", { title: "Open question" }),
    decidedGhost("ghosty", { title: "Ghost decision" }),
  );
  const r = await werk(p, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out.length).toBe(3);
  for (const [id, title] of [
    ["alpha", "Alpha decision"],
    ["beta", "Beta decision"],
    ["gamma", "Gamma decision"],
  ]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("Open question");
  expect(r.stdout).not.toContain("Ghost decision");
});

test("09.2 two terms, best match first", async () => {
  const p = project();
  seed(
    p,
    decided("cache-layout", {
      title: "Cache layout",
      body: "Cache eviction runs on a timer. The eviction policy is LRU.",
    }),
    real("evict-timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("cache-size", { title: "Cache size", body: "Sizes are fixed." }),
    real("gone", { title: "Old note", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await werk(p, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out.length).toBe(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("evict-timer");
  expect(out[1]).toContain("open");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Old note");
});

test("09.3 a rejected option's why-not is found, and the search narrows", async () => {
  const p = project();
  seed(
    p,
    decided("parent-topic", { title: "Parent topic" }),
    real("storage", { title: "Storage format", parent: "parent-topic" }),
    real("storage:opt0", {
      kind: "option",
      title: "Use a database",
      why: "SQLite needs a native build",
    }),
    edge("storage:opt0", "storage", "alternative_to", "the other way"),
    { type: "node.edited", id: "storage", who: "you", noBasis: "fixture" },
    { type: "criterion.added", id: "storage", form: "revisit" },
    { type: "node.decided", id: "storage" },
    real("elsewhere", { title: "Elsewhere", body: "we might use sqlite here" }),
  );
  const all = await werk(p, "search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
  expect(all.stdout).toContain("elsewhere");
  const under = await werk(p, "search", "sqlite", "--under", "parent-topic");
  expect(lines(under.stdout).length).toBe(1);
  expect(under.stdout).toContain("storage");
  const status = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(status.stdout).length).toBe(1);
  expect(status.stdout).toContain("storage");
});

test("09.4 find lists the open work under one card", async () => {
  const p = project();
  seed(
    p,
    decided("client", { title: "Client" }),
    real("routing", { title: "Routing", parent: "client" }),
    real("theme", { title: "Theme", parent: "client", status: "proto" }),
    real("route-guards", { title: "Route guards", parent: "routing" }),
    // a paused card: it depends on a card that is later postponed
    decided("postponed-card", { title: "Postponed card", parent: "client" }),
    real("paused-card", { title: "Paused card", parent: "client" }),
    edge("paused-card", "postponed-card", "depends_on", "needs it"),
    // a stale card: it depends on a card that is later reopened
    decided("origin-y", { title: "Origin Y" }),
    real("stale-card", { title: "Stale card", parent: "client" }),
    edge("stale-card", "origin-y", "depends_on", "needs it"),
    real("routing:opt0", { kind: "option", title: "Opt zero", why: "no" }),
    edge("routing:opt0", "routing", "alternative_to", "other"),
    real("routing-src", { kind: "source", title: "Routing source" }),
    edge("routing", "routing-src", "supported_by", "evidence"),
    real("billing", { title: "Billing" }),
    { type: "node.reopened", id: "postponed-card", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "origin-y", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "find", "routing");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out[0]).toContain("routing");
  expect(out[1]).toContain("route-guards");
  expect(r.stdout).not.toContain("billing");
  expect(r.stdout).not.toContain("Opt zero");
  expect(r.stdout).not.toContain("Routing source");

  const c = await werk(p, "find", "client");
  expect(c.code).toBe(0);
  const text = c.stdout;
  expect(text).toContain("routing  ");
  expect(text).toContain("theme");
  expect(text.indexOf("routing  ")).toBeLessThan(text.indexOf("route-guards"));
  expect(text.indexOf("theme")).toBeLessThan(text.indexOf("route-guards"));
  expect(lines(text).some((l) => /^client\s/.test(l))).toBe(false);
  expect(text).not.toContain("paused-card");
  expect(text).not.toContain("stale-card");
  expect(text).not.toContain("postponed-card");
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = project();
  seed(
    p,
    real("tree-one", { title: "Tree one work" }),
    real("tree-two", { title: "Tree two work" }),
    decided("auth-flow", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth-flow", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("tree-one");
  expect(r.stdout).toContain("tree-two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});

void ghost;
