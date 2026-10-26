import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Cli, cli, decided, ghost, link, open, reopen } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
});
afterEach(() => c.dispose());

const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const noProblems = async () => {
  const r = await c.werk("show", "--help-never-mind").catch(() => null);
  void r;
};
void noProblems;

test("09.1 search with no term lists the decided cards only", async () => {
  c.write([
    ...decided("d1", { title: "Decided one" }),
    ...decided("d2", { title: "Decided two" }),
    ...decided("d3", { title: "Decided three" }),
    ...open("o1", { title: "Open one" }),
    ghost("g1", { title: "Ghost one", status: "decided" }),
  ]);
  const r = await c.werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  expect(r.stdout).toContain("d1  Decided one");
  expect(r.stdout).toContain("d2  Decided two");
  expect(r.stdout).toContain("d3  Decided three");
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghost one");
});

test("09.2 two terms, best match first, removed and partial cards left out", async () => {
  c.write([
    ...decided("layout", { title: "Cache layout", body: "Cache eviction happens by the eviction policy" }),
    ...open("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    ...decided("size", { title: "Cache size", body: "how big" }),
    ...open("gone", { title: "Gone", body: "cache eviction" }),
  ]);
  expect((await c.werk("remove", "gone", "--actor", "you")).code).toBe(0);
  const r = await c.werk("search", "cache", "eviction");
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("layout");
  expect(out[0]).toContain("decided");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("timer");
  expect(out[1]).toContain("open");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 a word in a rejected option's why-not finds the card; --under and --status narrow", async () => {
  c.write([
    ...decided("parent", { title: "Parent topic" }),
    ...decided("storage", { title: "Storage format", parent: "parent" }),
    ...open("opt", { title: "Use a database", kind: "option", why: "SQLite needs a native build" }),
    { type: "edge.added", from: "opt", to: "storage", link: "alternative_to", why: "" },
    ...open("other", { title: "Elsewhere", body: "we could use sqlite here" }),
  ]);
  const all = await c.werk("search", "sqlite");
  const out = lines(all.stdout);
  expect(out).toHaveLength(2);
  expect(all.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
  expect(all.stdout).toMatch(/other\s+\[open\]\s+Elsewhere/);
  const under = lines((await c.werk("search", "sqlite", "--under", "parent")).stdout);
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("Storage format");
  const status = lines((await c.werk("search", "sqlite", "--status", "decided")).stdout);
  expect(status).toHaveLength(1);
  expect(status[0]).toContain("Storage format");
});

test("09.4 find lists open work under one card, breadth first, with no marked card", async () => {
  c.write([
    ...decided("client", { title: "Client" }),
    ...open("routing", { title: "Routing", parent: "client" }),
    ...open("theme", { title: "Theme", parent: "client", status: "proto" }),
    ...open("guards", { title: "Route guards", parent: "routing" }),
    // base cards for the marks
    ...decided("basis1", { title: "Basis one" }),
    ...decided("basis2", { title: "Basis two" }),
    ...open("stalecard", { title: "Stale card", parent: "client" }),
    link("stalecard", "basis1"),
    ...open("pausedcard", { title: "Paused card", parent: "client" }),
    link("pausedcard", "basis2"),
    ...decided("postponedcard", { title: "Postponed card", parent: "client" }),
    reopen("basis1", { reason: "invalidated" }),
    reopen("basis2", { reason: "postponed" }),
    reopen("postponedcard", { reason: "postponed" }),
    // an option and a source on Routing
    ...open("opt", { title: "An option", kind: "option", why: "no" }),
    { type: "edge.added", from: "opt", to: "routing", link: "alternative_to", why: "" },
    ...open("src", { title: "A source", kind: "source", why: "finding" }),
    { type: "edge.added", from: "routing", to: "src", link: "supported_by", why: "" },
    ...open("billing", { title: "Billing" }),
  ]);
  const shown = await c.werk("show", "stalecard");
  expect(shown.stdout).toContain("STALE");
  expect((await c.werk("show", "pausedcard")).stdout).toContain("PAUSED");
  expect((await c.werk("show", "postponedcard")).stdout).toContain("POSTPONED");
  const r = await c.werk("find", "routing");
  const out = lines(r.stdout);
  expect(out[0]).toContain("Routing");
  expect(out[1]).toContain("Route guards");
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("An option");
  expect(r.stdout).not.toContain("A source");
  const k = await c.werk("find", "client");
  const kout = lines(k.stdout);
  const at = (s: string) => kout.findIndex((l) => l.includes(s));
  expect(at("Routing")).toBeGreaterThanOrEqual(0);
  expect(at("Theme")).toBeGreaterThanOrEqual(0);
  expect(at("Route guards")).toBeGreaterThan(Math.max(at("Routing"), at("Theme")));
  expect(k.stdout).not.toMatch(/\bclient\b\s+\[/);
  expect(k.stdout).not.toContain("Stale card");
  expect(k.stdout).not.toContain("Paused card");
  expect(k.stdout).not.toContain("Postponed card");
});

test("09.5 a card reopened as rejected is work in every tree; find with no id lists both trees", async () => {
  c.write([
    ...open("t1", { title: "Tree one open" }),
    ...open("t2", { title: "Tree two open" }),
    ...decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  ]);
  const r = await c.werk("find");
  expect(r.stdout).toContain("Tree one open");
  expect(r.stdout).toContain("Tree two open");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
