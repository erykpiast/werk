import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProject,
  decided,
  ghost,
  link,
  open,
  type Project,
  seedMap,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

test("09.1 an agent lists the index of decided cards", async () => {
  seedMap(
    p,
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    open("o1", { title: "Open one" }),
    // a ghost whose status says decided
    ghost("g1", { title: "Ghost one", status: "decided" }),
  );
  const r = await werk(p, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ]) {
    expect(
      out.some((l) => l.includes(id as string) && l.includes(title as string)),
    ).toBe(true);
  }
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 two terms, best match first", async () => {
  seedMap(
    p,
    decided("layout", {
      title: "Cache layout",
      body: "Cache eviction rules.\n\nThe eviction policy is LRU.",
    }),
    open("timer", {
      title: "Eviction timer",
      why: "eviction needs a clock",
      body: "CACHE warmup",
    }),
    decided("size", { title: "Cache size", body: "cache" }),
    decided("gone", { title: "Gone card", body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  );
  const r = await werk(p, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone card");
});

test("09.3 a word in a rejected option finds the card, and the search narrows", async () => {
  seedMap(
    p,
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    open("opt", {
      kind: "option",
      title: "Use a database",
      why: "SQLite needs a native build",
    }),
    {
      type: "edge.added",
      from: "opt",
      to: "storage",
      link: "alternative_to",
      why: "w",
    },
    open("other", {
      title: "Other open card",
      body: "we could use sqlite here",
    }),
  );
  const all = await werk(p, "search", "sqlite");
  expect(all.code).toBe(0);
  expect(all.stdout).toContain("Storage format");
  expect(all.stdout).toMatch(/storage\s+\[decided\]/);
  expect(all.stdout).toContain("Other open card");
  const under = await werk(p, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const status = await werk(p, "search", "sqlite", "--status", "decided");
  expect(lines(status.stdout)).toHaveLength(1);
  expect(status.stdout).toContain("Storage format");
});

test("09.4 an agent finds the open work under one card", async () => {
  seedMap(
    p,
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // paused: depends on a postponed card
    decided("base", { title: "Base card" }),
    decided("postcard", { title: "Postponed card", parent: "client" }),
    open("pausedcard", { title: "Paused card", parent: "client" }),
    open("stalecard", { title: "Stale card", parent: "client" }),
    link("pausedcard", "postcard"),
    link("stalecard", "base"),
    open("opt", { kind: "option", title: "Routing option", why: "no" }),
    {
      type: "edge.added",
      from: "opt",
      to: "routing",
      link: "alternative_to",
      why: "w",
    },
    open("src", { kind: "source", title: "Routing source" }),
    {
      type: "edge.added",
      from: "routing",
      to: "src",
      link: "supported_by",
      why: "w",
    },
    open("billing", { title: "Billing" }),
    {
      type: "node.reopened",
      id: "postcard",
      reason: "postponed",
      at: "2026-10-10T09:00:00.000Z",
    },
    {
      type: "node.reopened",
      id: "base",
      reason: "invalidated",
      at: "2026-10-10T09:00:00.000Z",
    },
  );
  const r = await werk(p, "find", "routing");
  expect(r.code).toBe(0);
  expect(r.stdout.indexOf("Routing")).toBeGreaterThanOrEqual(0);
  expect(r.stdout.indexOf("Route guards")).toBeGreaterThan(
    r.stdout.indexOf("Routing"),
  );
  for (const t of ["Billing", "Routing option", "Routing source"]) {
    expect(r.stdout).not.toContain(t);
  }
  const c = await werk(p, "find", "client");
  expect(c.code).toBe(0);
  const out = c.stdout;
  expect(out).toContain("Routing");
  expect(out).toContain("Theme");
  expect(out.indexOf("Route guards")).toBeGreaterThan(out.indexOf("Routing"));
  expect(out.indexOf("Route guards")).toBeGreaterThan(out.indexOf("Theme"));
  expect(out).not.toMatch(/client\s+\[/);
  for (const t of ["Paused card", "Stale card", "Postponed card"]) {
    expect(out).not.toContain(t);
  }
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seedMap(
    p,
    open("t1", { title: "Tree one open" }),
    open("t2", { title: "Tree two open" }),
    decided("auth", { title: "Auth flow" }),
    {
      type: "node.reopened",
      id: "auth",
      reason: "rejected",
      at: "2026-10-10T09:00:00.000Z",
    },
  );
  const r = await werk(p, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one open");
  expect(r.stdout).toContain("Tree two open");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
