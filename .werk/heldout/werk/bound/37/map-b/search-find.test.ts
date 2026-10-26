import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  decided,
  ghost,
  link,
  open,
  reopen,
} from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { seed, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("09.1 search with no term lists only decided real cards", async () => {
  seed(
    project,
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    open("o1", { title: "Open card" }),
    // a ghost whose status was decided before it became a ghost
    ghost("g1", { title: "Ghost card", status: "decided" }),
  );
  const r = await werk(project, "search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  expect(r.stdout).toContain("d1  Decided one");
  expect(r.stdout).toContain("d2  Decided two");
  expect(r.stdout).toContain("d3  Decided three");
  expect(r.stdout).not.toContain("Open card");
  expect(r.stdout).not.toContain("Ghost card");
});

test("09.2 two terms, best match first", async () => {
  seed(
    project,
    decided("cl", {
      title: "Cache layout",
      body: "Cache eviction happens by eviction policy",
    }),
    open("et", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("cs", { title: "Cache size", body: "cache only" }),
    decided("rm", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "rm" },
  );
  const r = await werk(project, "search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cl");
  expect(out[0]).toContain("[decided]");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("et");
  expect(out[1]).toContain("[open]");
  expect(out[1]).toContain("Eviction timer");
  expect(r.stdout).not.toContain("Cache size");
  expect(r.stdout).not.toContain("Gone");
});

test("09.3 find by a why-not word, narrow with --under and --status", async () => {
  seed(
    project,
    decided("parent", { title: "Parent topic" }),
    decided("sf", { title: "Storage format", parent: "parent" }),
    open("opt", {
      kind: "option",
      title: "Use SQLite",
      why: "SQLite needs a native build",
    }),
    link("opt", "sf", "alternative_to"),
    open("elsewhere", { title: "Elsewhere", body: "we could use sqlite" }),
  );
  const all = await werk(project, "search", "sqlite");
  expect(all.stdout).toContain("sf  [decided]  Storage format");
  expect(all.stdout).toContain("elsewhere  [open]  Elsewhere");
  const under = await werk(project, "search", "sqlite", "--under", "parent");
  expect(lines(under.stdout)).toEqual(["sf  [decided]  Storage format"]);
  const st = await werk(project, "search", "sqlite", "--status", "decided");
  expect(lines(st.stdout)).toEqual(["sf  [decided]  Storage format"]);
});

function workTree() {
  return [
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    // postponed card
    ...decided("hold", { title: "Hold card", parent: "client" }),
    reopen("hold", { reason: "postponed" }),
    // stale card: depends on a card that is reopened as invalidated
    ...decided("src1", { title: "Source one" }),
    ...open("stl", { title: "Stale card", parent: "client" }),
    link("stl", "src1"),
    reopen("src1", { reason: "invalidated" }),
    // paused card: depends on a card that is postponed
    ...decided("src2", { title: "Source two" }),
    ...open("pse", { title: "Paused card", parent: "client" }),
    link("pse", "src2"),
    reopen("src2", { reason: "postponed" }),
    // option and source on Routing
    ...open("ropt", { kind: "option", title: "Routing option", why: "no" }),
    link("ropt", "routing", "alternative_to"),
    ...open("rsrc", { kind: "source", title: "Routing source" }),
    link("routing", "rsrc", "supported_by"),
    ...open("billing", { title: "Billing" }),
  ];
}

test("09.4 find lists open work under one card", async () => {
  seed(project, ...workTree().flat());
  const show = await werk(project, "show", "pse");
  const r1 = await werk(project, "find", "routing");
  expect(r1.code).toBe(0);
  const o1 = lines(r1.stdout);
  expect(o1[0]).toContain("routing");
  expect(o1[1]).toContain("guards");
  expect(r1.stdout).not.toContain("Billing");
  expect(r1.stdout).not.toContain("Routing option");
  expect(r1.stdout).not.toContain("Routing source");
  const r2 = await werk(project, "find", "client");
  const o2 = lines(r2.stdout);
  const at = (t: string) => o2.findIndex((l) => l.includes(t));
  expect(at("Routing")).toBeGreaterThanOrEqual(0);
  expect(at("Theme")).toBeGreaterThanOrEqual(0);
  expect(at("Route guards")).toBeGreaterThan(at("Routing"));
  expect(at("Route guards")).toBeGreaterThan(at("Theme"));
  expect(r2.stdout).not.toMatch(/^client /m);
  expect(r2.stdout).not.toContain("Hold card");
  expect(r2.stdout).not.toContain("Stale card");
  expect(r2.stdout).not.toContain("Paused card");
  // sanity of the fixture: the marks exist
  expect(show.stdout).toMatch(/PAUSED|paused/i);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(
    project,
    ...open("t1", { title: "Tree one" }),
    ...open("t2", { title: "Tree two" }),
    ...decided("auth", { title: "Auth flow" }),
    reopen("auth", { reason: "rejected" }),
  );
  const r = await werk(project, "find");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Tree one");
  expect(r.stdout).toContain("Tree two");
  expect(r.stdout).toContain("Auth flow");
  expect(r.stdout).not.toContain("[decided]");
});
