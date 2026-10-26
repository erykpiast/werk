import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderOpenCard } from "../src/serve/open-card.ts";
import { readMap } from "../src/map/log-store.ts";
import {
  accepted,
  card,
  createProject,
  decided,
  edge,
  type Project,
  proposed,
  refines,
  reopen,
  seed,
  werkOf,
} from "./support.ts";

let project: Project;
let werk: ReturnType<typeof werkOf>;
beforeEach(() => {
  project = createProject();
  werk = werkOf(project);
});
afterEach(() => project.dispose());

const logLines = () => readFileSync(project.logPath, "utf8").trim().split("\n");
const lineCount = () => project.events().length;
const ids = (text: string) => text.split("\n").filter(Boolean).map((l) => l.split(/\s+/)[0]);

// ---------------------------------------------------------------- 06
test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async () => {
  seed(project, decided("c", { title: "The card", why: "its words" }));
  const added = await werk(
    "add",
    "ex1",
    "--kind",
    "excerpt",
    "--title",
    "Maria",
    "--body",
    "we need fifteen minutes",
  );
  expect(added.stderr).not.toContain("--kind must be");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  const link = await werk("link", "c", "ex1", "--type", "supported_by", "--why", "she said it");
  expect(link.code).toBe(0);
  const { map } = readMap(project.logPath);
  expect(map.nodes.get("ex1")?.proposed).toBe(true);
  expect(map.ghostEdges.some((e) => e.from === "c" && e.to === "ex1")).toBe(true);
  expect(map.nodes.get("c")?.status).toBe("decided");
  expect(map.nodes.get("c")?.title).toBe("The card");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  seed(
    project,
    decided("c", { title: "The card" }),
    proposed("ex1", { kind: "excerpt", title: "Maria", body: "fifteen minutes" }),
    edge("c", "ex1", "supported_by", "she said it"),
  );
  let map = readMap(project.logPath).map;
  expect(map.nodes.get("ex1")?.proposed).toBe(true);
  const acc = await werk("accept", "ex1", "--actor", "you");
  expect(acc.code).toBe(0);
  map = readMap(project.logPath).map;
  expect(map.nodes.get("ex1")?.proposed).toBe(false);
  expect(map.edges.some((e) => e.from === "c" && e.to === "ex1" && e.type === "supported_by")).toBe(true);
  expect(map.ghostEdges).toHaveLength(0);
  const open = JSON.stringify(renderOpenCard(map, "c"));
  expect(open).toContain("Maria");
});

// ---------------------------------------------------------------- 08
const removalMap = () =>
  seed(
    project,
    decided("auth", { title: "Auth" }),
    card("login", { title: "Login" }),
    card("session", { title: "Session" }),
    card("audit", { title: "Audit" }),
    refines("login", "auth"),
    refines("session", "auth"),
    edge("login", "audit", "depends_on", "login audits"),
  );

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  removalMap();
  const before = lineCount();
  const removed = await werk("remove", "auth", "--actor", "you");
  expect(removed.stderr).not.toContain("unknown flag");
  expect(removed.code).toBe(0);
  const map = readMap(project.logPath).map;
  for (const id of ["auth", "login", "session"]) expect(map.nodes.has(id)).toBe(false);
  expect(lineCount()).toBe(before + 1);
  const list = await werk("removed");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("auth");
  expect(list.stdout).toContain("login");
  expect(list.stdout).toContain("session");
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const restored = await werk("restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  const back = readMap(project.logPath).map;
  expect(back.parents.get("login")).toBe("auth");
  expect(back.parents.get("session")).toBe("auth");
  expect(back.edges.some((e) => e.from === "login" && e.to === "audit")).toBe(true);
  expect((await werk("removed")).stdout.trim()).toBe("");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  seed(
    project,
    decided("platform"),
    card("auth"),
    card("login"),
    card("session"),
    refines("auth", "platform"),
    refines("login", "auth"),
    refines("session", "auth"),
  );
  const removed = await werk("remove", "auth", "--actor", "you", "--reparent");
  expect(removed.code).toBe(0);
  let map = readMap(project.logPath).map;
  expect(map.nodes.has("auth")).toBe(false);
  expect(map.parents.get("login")).toBe("platform");
  expect(map.parents.get("session")).toBe("platform");
  const restored = await werk("restore", "auth", "--actor", "you");
  expect(restored.code).toBe(0);
  map = readMap(project.logPath).map;
  expect(map.parents.get("auth")).toBe("platform");
  expect(map.parents.get("login")).toBe("auth");
  expect(map.parents.get("session")).toBe("auth");
});

test("08.3 a link waits until both of its ends are back", async () => {
  seed(
    project,
    card("login"),
    card("session"),
    edge("login", "session", "depends_on", "needs it"),
  );
  const has = () =>
    readMap(project.logPath).map.edges.some((e) => e.from === "login" && e.to === "session");
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
  expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
  expect(readMap(project.logPath).map.nodes.has("login")).toBe(true);
  expect(has()).toBe(false);
  expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
  expect(has()).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  seed(
    project,
    card("login"),
    card("billing"),
    proposed("rfc-6749", { kind: "source", title: "RFC 6749" }),
    accepted("rfc-6749"),
    edge("login", "rfc-6749", "supported_by", "cites"),
    edge("billing", "rfc-6749", "supported_by", "cites"),
  );
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  const map = readMap(project.logPath).map;
  expect(map.nodes.has("rfc-6749")).toBe(true);
  expect(map.edges.some((e) => e.from === "billing" && e.to === "rfc-6749")).toBe(true);
  const added = await werk("add", "login", "--title", "New login");
  expect(added.code).not.toBe(0);
  expect(added.stderr).toContain("restore");
  expect(added.stderr).toContain("login");
  expect(readMap(project.logPath).map.nodes.has("login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  seed(project, card("login"));
  const before = lineCount();
  const result = await werk("remove", "login");
  expect(result.code).not.toBe(0);
  expect(readMap(project.logPath).map.nodes.has("login")).toBe(true);
  expect(lineCount()).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  seed(project, card("login"), { type: "node.removed", id: "login", actor: "you" });
  expect(readMap(project.logPath).map.nodes.has("login")).toBe(false);
  const before = lineCount();
  const result = await werk("restore", "login");
  expect(result.code).not.toBe(0);
  expect(readMap(project.logPath).map.nodes.has("login")).toBe(false);
  expect(lineCount()).toBe(before);
});

// ---------------------------------------------------------------- 09
test("09.1 an agent lists the index of decided cards", async () => {
  seed(
    project,
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    card("o1", { title: "Open one" }),
    proposed("g1", { title: "Ghost one", status: "decided" }),
  );
  const out = await werk("search");
  expect(out.code).toBe(0);
  const lines = out.stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(3);
  for (const [id, title] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
    expect(lines.some((l) => l.includes(id as string) && l.includes(title as string))).toBe(true);
  }
  expect(out.stdout).not.toContain("o1");
  expect(out.stdout).not.toContain("Ghost");
});

test("09.2 an agent searches with two terms and sees the best match first", async () => {
  seed(
    project,
    decided("cache-layout", {
      title: "Cache layout",
      body: "Cache eviction happens here. The eviction policy is LRU.",
    }),
    card("evict-timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("cache-size", { title: "Cache size", body: "cache is small" }),
    card("gone", { title: "Gone", body: "cache eviction" }),
    { type: "node.removed", id: "gone", actor: "you" },
  );
  const out = await werk("search", "cache", "eviction");
  expect(out.code).toBe(0);
  const lines = out.stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("cache-layout");
  expect(lines[0]).toContain("decided");
  expect(lines[0]).toContain("Cache layout");
  expect(lines[1]).toContain("evict-timer");
  expect(lines[1]).toContain("open");
  expect(out.stdout).not.toContain("cache-size");
  expect(out.stdout).not.toContain("gone");
});

test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
  seed(
    project,
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format" }),
    refines("storage", "parent"),
    proposed("storage:opt0", { kind: "option", title: "Use a database", why: "SQLite needs a native build" }),
    accepted("storage:opt0"),
    edge("storage:opt0", "storage", "alternative_to", "rejected"),
    card("elsewhere", { title: "Elsewhere", body: "we like sqlite here" }),
  );
  const all = await werk("search", "sqlite");
  expect(all.code).toBe(0);
  const lines = all.stdout.split("\n").filter(Boolean);
  expect(lines.some((l) => l.includes("storage") && l.includes("decided"))).toBe(true);
  expect(lines.some((l) => l.includes("elsewhere"))).toBe(true);
  const under = await werk("search", "sqlite", "--under", "parent");
  expect(under.stdout.split("\n").filter(Boolean)).toHaveLength(1);
  expect(under.stdout).toContain("storage");
  const status = await werk("search", "sqlite", "--status", "decided");
  expect(status.stdout.split("\n").filter(Boolean)).toHaveLength(1);
  expect(status.stdout).toContain("storage");
});

const findTree = () =>
  seed(
    project,
    decided("client", { title: "Client" }),
    card("routing", { title: "Routing" }),
    refines("routing", "client"),
    card("theme", { title: "Theme", status: "proto" }),
    refines("theme", "client"),
    card("guards", { title: "Route guards" }),
    refines("guards", "routing"),
    // paused: depends on a postponed card
    decided("pz"),
    card("paused-card", { title: "Paused card" }),
    refines("paused-card", "client"),
    edge("paused-card", "pz", "depends_on", "needs pz"),
    reopen("pz", { reason: "postponed" }),
    // stale: depends on a reopened (invalidated) card
    decided("sz"),
    card("stale-card", { title: "Stale card" }),
    refines("stale-card", "client"),
    edge("stale-card", "sz", "depends_on", "needs sz"),
    reopen("sz", { reason: "invalidated" }),
    // postponed: a decided card under client, then reopened as postponed
    decided("postponed-card", { title: "Postponed card" }),
    refines("postponed-card", "client"),
    reopen("postponed-card", { reason: "postponed" }),
    proposed("routing:opt", { kind: "option", title: "An option", why: "no" }),
    accepted("routing:opt"),
    edge("routing:opt", "routing", "alternative_to", "no"),
    proposed("src1", { kind: "source", title: "A source" }),
    accepted("src1"),
    edge("routing", "src1", "supported_by", "cite"),
    card("billing", { title: "Billing" }),
  );

test("09.4 an agent finds the open work under one card", async () => {
  findTree();
  const routing = await werk("find", "routing");
  expect(routing.code).toBe(0);
  const r = ids(routing.stdout);
  expect(r[0]).toBe("routing");
  expect(r[1]).toBe("guards");
  for (const bad of ["billing", "routing:opt", "src1"]) expect(r).not.toContain(bad);
  const client = await werk("find", "client");
  const c = ids(client.stdout);
  expect(c).toContain("routing");
  expect(c).toContain("theme");
  expect(c.indexOf("routing")).toBeLessThan(c.indexOf("guards"));
  expect(c.indexOf("theme")).toBeLessThan(c.indexOf("guards"));
  expect(c).not.toContain("client");
  for (const bad of ["paused-card", "stale-card", "postponed-card"]) expect(c).not.toContain(bad);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seed(
    project,
    card("tree-a", { title: "Tree A" }),
    card("tree-b", { title: "Tree B" }),
    decided("auth-flow", { title: "Auth flow" }),
    reopen("auth-flow", { reason: "rejected" }),
  );
  const out = await werk("find");
  expect(out.code).toBe(0);
  const found = ids(out.stdout);
  expect(found).toContain("tree-a");
  expect(found).toContain("tree-b");
  expect(found).toContain("auth-flow");
  expect(out.stdout).not.toContain("[decided]");
});

// ---------------------------------------------------------------- 11
const rollupLine = (text: string) =>
  text.split("\n").filter((l) => /roll/i.test(l) || /\b\d+ cards?\b/i.test(l));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    card("c1", { title: "Child one" }),
    card("c2", { title: "Child two", status: "proto" }),
    card("g1", { title: "Grandchild" }),
    { type: "node.edited", id: "g1", who: "me", noBasis: "x" },
    { type: "criterion.added", id: "g1", form: "revisit" },
    { type: "node.decided", id: "g1" },
    refines("c1", "root"),
    refines("c2", "root"),
    refines("g1", "c1"),
    { type: "node.edited", id: "root", who: "me", noBasis: "x" },
    { type: "criterion.added", id: "root", form: "revisit" },
    { type: "node.decided", id: "root" },
  );
  const out = await werk("show", "root");
  expect(out.code).toBe(0);
  const lines = rollupLine(out.stdout);
  expect(lines).toHaveLength(1);
  const line = lines[0] as string;
  expect(line).toMatch(/\b4 cards\b/);
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(
    project,
    card("parent", { title: "Parent" }),
    card("child", { title: "Child" }),
    card("gc1", { title: "GC one" }),
    card("gc2", { title: "GC two" }),
    { type: "node.edited", id: "gc2", who: "me", noBasis: "x" },
    { type: "criterion.added", id: "gc2", form: "revisit" },
    { type: "node.decided", id: "gc2" },
    refines("child", "parent"),
    refines("gc1", "child"),
    refines("gc2", "child"),
  );
  const out = await werk("show", "parent");
  expect(out.code).toBe(0);
  const text = out.stdout;
  const link = text.split("\n").find((l) => l.includes("<-") && l.includes("refines") && l.includes("child"));
  expect(link).toBeDefined();
  const around = text.split("\n").slice(text.split("\n").indexOf(link as string), text.split("\n").indexOf(link as string) + 3).join("\n");
  expect(around).toMatch(/\b3 cards\b/);
  expect(text).toMatch(/\b4 cards\b/);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  seed(
    project,
    decided("dep", { title: "Dep" }),
    card("c", { title: "The card" }),
    edge("c", "dep", "depends_on", "needs the dep for timing"),
    proposed("c:opt", { kind: "option", title: "Use cookies", why: "cookies leak" }),
    accepted("c:opt"),
    edge("c:opt", "c", "alternative_to", "no"),
    proposed("ex", { kind: "excerpt", title: "Maria", body: "fifteen minutes exactly" }),
    accepted("ex"),
    edge("c", "ex", "supported_by", "said so"),
    proposed("src", { kind: "source", title: "Link study", why: "links last one minute" }),
    edge("c", "src", "supported_by", "evidence"),
  );
  const out = await werk("show", "c");
  expect(out.code).toBe(0);
  const t = out.stdout;
  expect(t).toContain("needs the dep for timing");
  const iOpt = t.indexOf("Options");
  expect(iOpt).toBeGreaterThan(t.indexOf("needs the dep for timing"));
  expect(t.slice(iOpt)).toContain("Use cookies");
  expect(t.slice(iOpt)).toContain("cookies leak");
  const iSay = t.indexOf("Say");
  expect(iSay).toBeGreaterThan(-1);
  expect(t.slice(iSay)).toContain("Maria");
  expect(t.slice(iSay)).toContain("fifteen minutes exactly");
  const iEv = t.indexOf("Ev");
  expect(iEv).toBeGreaterThan(-1);
  const ev = t.slice(t.indexOf("\nEv"));
  expect(ev).toContain("Link study");
  expect(ev).toContain("links last one minute");
  expect(ev).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(
    project,
    card("c", { title: "The card" }),
    proposed("ex", { kind: "excerpt", title: "Maria", body: "words" }),
    accepted("ex"),
    edge("c", "ex", "supported_by", "said"),
    proposed("src", { kind: "source", title: "Study", why: "finding" }),
    accepted("src"),
    edge("c", "src", "supported_by", "ev"),
  );
  const out = await werk("show", "c");
  expect(out.code).toBe(0);
  expect(out.stdout).toMatch(/^Say/m);
  expect(out.stdout).toMatch(/^Ev/m);
  expect(out.stdout).not.toMatch(/^Options/m);
});

test("11.5 show with no id prints the root card", async () => {
  seed(
    project,
    card("root", { title: "The root title" }),
    card("second", { title: "Second card" }),
    refines("second", "root"),
  );
  const out = await werk("show");
  expect(out.code).toBe(0);
  expect(out.stdout).toContain("The root title");
  expect(out.stdout).toMatch(/\b2 cards\b/);
  expect(out.stdout).toContain("second");
  expect(out.stdout).toContain("Second card");
});
