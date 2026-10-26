import { afterEach, expect, test } from "bun:test";
import { decided, ghost, link, mapOf, mk, open, reopen, type Project } from "./h.ts";

let p: Project | undefined;
afterEach(() => p?.dispose());
const out = (r: { stdout: string }) => r.stdout.split("\n").filter(Boolean);

test("09.1 index of decided cards", async () => {
  const { project, werk } = mk([
    ...decided("d1", { title: "Alpha" }),
    ...decided("d2", { title: "Beta" }),
    ...decided("d3", { title: "Gamma" }),
    ...open("o1", { title: "Open one" }),
    ghost("gh", { title: "Ghosty", status: "decided" }),
  ]);
  p = project;
  expect(mapOf(project).problems).toEqual([]);
  const r = await werk("search");
  expect(r.code).toBe(0);
  const l = out(r);
  expect(l.length).toBe(3);
  expect(l.join("\n")).toContain("d1  Alpha");
  expect(l.join("\n")).toContain("d2  Beta");
  expect(l.join("\n")).toContain("d3  Gamma");
  expect(r.stdout).not.toContain("Open one");
  expect(r.stdout).not.toContain("Ghosty");
});

test("09.2 two terms, best first", async () => {
  const { project, werk } = mk([
    ...decided("cl", { title: "Cache layout", body: "Cache eviction and eviction policy" }),
    ...open("et", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    ...decided("cs", { title: "Cache size", body: "cache only" }),
    ...open("rm", { title: "Removed one", body: "cache eviction" }),
    { type: "node.removed", id: "rm", actor: "you" },
  ]);
  p = project;
  const r = await werk("search", "cache", "eviction");
  const l = out(r);
  expect(l.length).toBe(2);
  expect(l[0]).toContain("cl");
  expect(l[0]).toContain("[decided]");
  expect(l[0]).toContain("Cache layout");
  expect(l[1]).toContain("et");
  expect(l[1]).toContain("[open]");
  expect(l[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Removed one");
});

test("09.3 option why-not, --under, --status", async () => {
  const { project, werk } = mk([
    ...decided("parent", { title: "Parent topic" }),
    ...decided("fmt", { title: "Storage format", parent: "parent" }),
    ...open("opt", { kind: "option", title: "SQLite", why: "SQLite needs a native build" }),
    link("opt", "fmt", "alternative_to"),
    ...open("elsewhere", { title: "Elsewhere", body: "we could use sqlite here" }),
  ]);
  p = project;
  expect(mapOf(project).problems).toEqual([]);
  // the option's title says SQLite too; the step says no title/why/body says it, only the why-not.
  // The option is not a card, so it is not listed itself.
  let l = out(await werk("search", "sqlite"));
  expect(l.some((x) => x.includes("fmt") && x.includes("[decided]"))).toBe(true);
  expect(l.some((x) => x.includes("elsewhere"))).toBe(true);
  expect(l.length).toBe(2);
  l = out(await werk("search", "sqlite", "--under", "parent"));
  expect(l.length).toBe(1);
  expect(l[0]).toContain("fmt");
  l = out(await werk("search", "sqlite", "--status", "decided"));
  expect(l.length).toBe(1);
  expect(l[0]).toContain("fmt");
});

test("09.4 find open work under a card", async () => {
  const { project, werk } = mk([
    ...decided("client", { title: "Client" }),
    ...open("routing", { title: "Routing", parent: "client" }),
    ...open("theme", { title: "Theme", parent: "client", status: "proto" }),
    ...open("guards", { title: "Route guards", parent: "routing" }),
    ...open("paused", { title: "Paused card", parent: "client" }),
    ...open("stale", { title: "Stale card", parent: "client" }),
    ...decided("post", { title: "Postponed card", parent: "client" }),
    ...decided("e1", { title: "Ext one" }),
    ...decided("e2", { title: "Ext two" }),
    link("stale", "e1"),
    link("paused", "e2"),
    ...open("opt", { kind: "option", title: "An option", parent: "routing" }),
    ...open("src", { kind: "source", title: "A source", parent: "routing" }),
    ...open("billing", { title: "Billing" }),
    reopen("e1", { reason: "invalidated" }),
    reopen("e2", { reason: "postponed" }),
    reopen("post", { reason: "postponed" }),
  ]);
  p = project;
  const m0 = mapOf(project);
  // make stale: amend-driven mark; try reopening a decided card under which stale child sits via basis
  const kindsOf = (id: string) => m0.nodes.get(id)?.marks.map((x) => x.kind);
  expect(kindsOf("stale")).toEqual(["stale"]);
  expect(kindsOf("paused")).toEqual(["paused"]);
  expect(kindsOf("post")).toEqual(["postponed"]);
  expect(m0.nodes.get("post")?.status).toBe("open");
  let r = await werk("find", "routing");
  let l = out(r);
  expect(l[0]).toContain("routing");
  expect(l[1]).toContain("guards");
  expect(r.stdout).not.toContain("Billing");
  expect(r.stdout).not.toContain("An option");
  expect(r.stdout).not.toContain("A source");
  r = await werk("find", "client");
  l = out(r);
  const idx = (s: string) => l.findIndex((x) => x.includes(s));
  expect(idx("Routing")).toBeGreaterThanOrEqual(0);
  expect(idx("Theme")).toBeGreaterThanOrEqual(0);
  expect(idx("Route guards")).toBeGreaterThan(Math.max(idx("Routing"), idx("Theme")));
  expect(r.stdout).not.toContain("Client\n");
  expect(l.some((x) => x.startsWith("client "))).toBe(false);
  expect(r.stdout).not.toContain("Postponed card");
  expect(r.stdout).not.toContain("Paused card");
  expect(r.stdout).not.toContain("Stale card");
});

test("09.5 reopened as rejected comes back; find with no id", async () => {
  const { project, werk } = mk([
    ...open("t1", { title: "Tree one" }),
    ...open("t2", { title: "Tree two" }),
    ...decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  ]);
  p = project;
  expect(mapOf(project).problems).toEqual([]);
  const r = await werk("find");
  expect(r.stdout).toContain("t1");
  expect(r.stdout).toContain("t2");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
