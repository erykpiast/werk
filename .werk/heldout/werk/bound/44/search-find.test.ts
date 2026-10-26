import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decided, ghost, link, problems, real, seed, werk, type Ev } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const reopen = (id: string, reason: string): Ev => ({
  type: "node.reopened",
  id,
  reason,
  at: "2026-10-10T09:00:00.000Z",
});
const option = (id: string, title: string, why: string): Ev[] => [
  { type: "node.proposed", id, kind: "option", title, status: "open", why },
  { type: "node.accepted", id, actor: "you" },
];

test("09.1 an agent lists the index of decided cards", async () => {
  seed(project, [
    ...decided("d1", "Decided one"),
    ...decided("d2", "Decided two"),
    ...decided("d3", "Decided three"),
    ...real("o1", "The open card"),
    ...decided("g1", "The ghost card", { accept: false }),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "search");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ]) {
    expect(out.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(r.stdout).not.toContain("The open card");
  expect(r.stdout).not.toContain("The ghost card");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  seed(project, [
    ...decided("cache-layout", "Cache layout", {
      body: "Cache eviction is handled here. The eviction policy is LRU.",
    }),
    ...real("eviction-timer", "Eviction timer", {
      why: "eviction needs a timer",
      body: "CACHE warmup runs first",
    }),
    ...decided("cache-size", "Cache size", { body: "The cache holds 10 MB." }),
    ...real("gone", "Gone card", { body: "cache eviction" }),
    { type: "node.removed", id: "gone" },
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "search", "cache", "eviction");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("eviction-timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone card");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  seed(project, [
    ...decided("parent", "Parent topic"),
    ...option("storage-opt", "Use SQLite", "SQLite needs a native build"),
    ...decided("storage", "Storage format", { parent: "parent" }),
    link("storage-opt", "storage", "alternative_to"),
    ...real("elsewhere", "Elsewhere", { body: "we could use sqlite here" }),
  ]);
  expect(problems(project)).toEqual([]);
  const all = await werk(project, "search", "sqlite");
  expect(all.code, all.stderr).toBe(0);
  const out = lines(all.stdout);
  // the option title says "SQLite" too, so only the card lines are checked
  expect(out.some((l) => l.includes("storage") && l.includes("[decided]") && l.includes("Storage format"))).toBe(true);
  expect(out.some((l) => l.includes("elsewhere"))).toBe(true);
  const under = await werk(project, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toHaveLength(1);
  expect(under.stdout).toContain("Storage format");
  const decidedOnly = await werk(project, "search", "sqlite", "--status", "decided");
  expect(lines(decidedOnly.stdout)).toHaveLength(1);
  expect(decidedOnly.stdout).toContain("Storage format");
});

function clientMap(): Ev[] {
  return [
    ...decided("client", "Client"),
    ...real("routing", "Routing", { parent: "client" }),
    ...real("theme", "Theme", { parent: "client", status: "proto" }),
    ...real("guards", "Route guards", { parent: "routing" }),
    ...real("paused-card", "Paused card", { parent: "client" }),
    ...real("stale-card", "Stale card", { parent: "client" }),
    ...decided("postponed-card", "Postponed card", { parent: "client" }),
    ...decided("pivot", "Pivot"),
    ...decided("shift", "Shift"),
    link("paused-card", "pivot", "depends_on", "needs pivot"),
    link("stale-card", "shift", "depends_on", "needs shift"),
    reopen("pivot", "postponed"),
    reopen("shift", "invalidated"),
    reopen("postponed-card", "postponed"),
    ...option("routing-opt", "Hash routing", "no deep links"),
    link("routing-opt", "routing", "alternative_to"),
    {
      type: "node.proposed",
      id: "routing-src",
      kind: "source",
      title: "Router survey",
      status: "open",
      why: "survey",
    },
    { type: "node.accepted", id: "routing-src", actor: "you" },
    link("routing", "routing-src", "supported_by"),
    ...real("billing", "Billing"),
  ];
}

test("09.4 an agent finds the open work under one card", async () => {
  seed(project, clientMap());
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "find", "routing");
  expect(r.code, r.stderr).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("Routing");
  expect(out[1]).toContain("Route guards");
  for (const word of ["Billing", "Hash routing", "Router survey"]) {
    expect(r.stdout).not.toContain(word);
  }
  const c = await werk(project, "find", "client");
  expect(c.code, c.stderr).toBe(0);
  const co = lines(c.stdout);
  const at = (word: string) => co.findIndex((l) => l.includes(word));
  expect(at("Routing")).toBeGreaterThanOrEqual(0);
  expect(at("Theme")).toBeGreaterThanOrEqual(0);
  expect(at("Routing")).toBeLessThan(at("Route guards"));
  expect(at("Theme")).toBeLessThan(at("Route guards"));
  expect(co.some((l) => /\bClient\b/.test(l) && l.startsWith("client"))).toBe(false);
  for (const word of ["Paused card", "Stale card", "Postponed card"]) {
    expect(c.stdout, word).not.toContain(word);
  }
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(project, [
    ...decided("r1", "Tree one root"),
    ...real("o1", "Open one", { parent: "r1" }),
    ...decided("auth", "Auth flow", { parent: "r1" }),
    reopen("auth", "rejected"),
    ...real("o2", "Open two"),
  ]);
  expect(problems(project)).toEqual([]);
  const r = await werk(project, "find");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("Open one");
  expect(r.stdout).toContain("Open two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
