import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProject, decided, ghost, link, open, seed, werk, type Project } from "../support.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const w = (...args: string[]) => werk(project, ...args);
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const real = (id: string, extra: Record<string, unknown> = {}) => open(id, extra);

describe("09 search and find", () => {
  test("09.1 the index lists the decided cards only", async () => {
    seed(
      project,
      decided("d1", { title: "Decided one" }),
      decided("d2", { title: "Decided two" }),
      decided("d3", { title: "Decided three" }),
      open("o1", { title: "Open one" }),
      // a card that was decided and then became a ghost: a proposed event that carries status decided
      ghost("g1", { title: "Ghost one", status: "decided" }),
    );
    const out = await w("search");
    expect(out.code).toBe(0);
    const ls = lines(out.stdout);
    expect(ls).toHaveLength(3);
    expect(out.stdout).toContain("d1  Decided one");
    expect(out.stdout).toContain("d2  Decided two");
    expect(out.stdout).toContain("d3  Decided three");
    expect(out.stdout).not.toContain("Open one");
    expect(out.stdout).not.toContain("Ghost one");
  });

  test("09.2 two terms, best match first", async () => {
    seed(
      project,
      real("layout", { title: "Cache layout", body: "Cache eviction. The eviction policy is LRU.", status: "decided" }),
      real("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
      real("size", { title: "Cache size", status: "decided" }),
      real("gone", { title: "Gone", body: "cache eviction" }),
    );
    expect((await w("remove", "gone", "--actor", "you")).code).toBe(0);
    const out = await w("search", "cache", "eviction");
    const ls = lines(out.stdout);
    expect(ls).toHaveLength(2);
    expect(ls[0]).toBe("layout  [decided]  Cache layout");
    expect(ls[1]).toBe("timer  [open]  Eviction timer");
    expect(out.stdout).not.toContain("Cache size");
    expect(out.stdout).not.toContain("Gone");
  });

  test("09.3 a word in a rejected option; narrow by --under and --status", async () => {
    seed(
      project,
      decided("parent", { title: "Parent topic" }),
      real("storage", { title: "Storage format", parent: "parent", status: "decided" }),
      ghost("opt", { kind: "option", title: "SQLite", why: "SQLite needs a native build" }),
      { type: "node.accepted", id: "opt", actor: "you" },
      { type: "edge.added", from: "opt", to: "storage", link: "alternative_to" },
      real("elsewhere", { title: "Elsewhere", body: "we might use sqlite later" }),
    );
    const all = await w("search", "sqlite");
    expect(all.stdout).toContain("storage  [decided]  Storage format");
    expect(all.stdout).toContain("elsewhere  [open]  Elsewhere");
    const under = await w("search", "sqlite", "--under", "parent");
    expect(lines(under.stdout)).toEqual(["storage  [decided]  Storage format"]);
    const st = await w("search", "sqlite", "--status", "decided");
    expect(lines(st.stdout)).toEqual(["storage  [decided]  Storage format"]);
  });

  test("09.4 find lists the open work under one card", async () => {
    seed(
      project,
      decided("client", { title: "Client" }),
      real("routing", { title: "Routing", parent: "client" }),
      real("theme", { title: "Theme", parent: "client", status: "proto" }),
      real("guards", { title: "Route guards", parent: "routing" }),
      // paused: depends on a card that is then postponed
      decided("pp", { title: "Postponed card", parent: "client" }),
      real("pausedcard", { title: "Paused card", parent: "client" }),
      link("pausedcard", "pp"),
      // stale: depends on a card that is then reopened as invalidated
      decided("qq", { title: "Upstream" }),
      real("stalecard", { title: "Stale card", parent: "client" }),
      link("stalecard", "qq"),
      { type: "node.reopened", id: "pp", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
      { type: "node.reopened", id: "qq", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
      ghost("ropt", { kind: "option", title: "Router option", why: "no" }),
      { type: "node.accepted", id: "ropt", actor: "you" },
      { type: "edge.added", from: "ropt", to: "routing", link: "alternative_to" },
      ghost("rsrc", { kind: "source", title: "Router source", why: "f" }),
      { type: "node.accepted", id: "rsrc", actor: "you" },
      { type: "edge.added", from: "routing", to: "rsrc", link: "supported_by" },
      real("billing", { title: "Billing" }),
    );
    const r = await w("find", "routing");
    expect(r.code).toBe(0);
    const rl = lines(r.stdout);
    expect(rl[0]).toContain("Routing");
    expect(rl[1]).toContain("Route guards");
    expect(r.stdout).not.toContain("Billing");
    expect(r.stdout).not.toContain("Router option");
    expect(r.stdout).not.toContain("Router source");
    const c = await w("find", "client");
    const cl = lines(c.stdout);
    const idx = (t: string) => cl.findIndex((l) => l.includes(t));
    expect(idx("Routing")).toBeGreaterThanOrEqual(0);
    expect(idx("Theme")).toBeGreaterThanOrEqual(0);
    expect(idx("Route guards")).toBeGreaterThan(Math.max(idx("Routing"), idx("Theme")));
    expect(c.stdout).not.toContain("[decided]");
    expect(c.stdout).not.toContain("Paused card");
    expect(c.stdout).not.toContain("Stale card");
    expect(c.stdout).not.toContain("Postponed card");
  });

  test("09.5 a card reopened as rejected is work in every tree", async () => {
    seed(
      project,
      real("t1", { title: "Tree one" }),
      real("t2", { title: "Tree two" }),
      decided("auth", { title: "Auth flow" }),
      { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
    );
    const r = await w("find");
    expect(r.stdout).toContain("Tree one");
    expect(r.stdout).toContain("Tree two");
    expect(r.stdout).toContain("Auth flow");
    expect(r.stdout).not.toContain("[decided]");
  });
});

describe("11 show and rollup", () => {
  test("11.1 the rollup counts the card and its subtree", async () => {
    seed(
      project,
      real("root", { title: "Root", status: "decided" }),
      real("c1", { title: "Open child", parent: "root" }),
      real("c2", { title: "Proto child", parent: "root", status: "proto" }),
      real("g", { title: "Grandchild", parent: "c1", status: "decided" }),
    );
    const out = (await w("show", "root")).stdout;
    const rl = out.split("\n").filter((l) => l.startsWith("rollup:"));
    expect(rl).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    seed(
      project,
      real("parent", { title: "Parent" }),
      real("child", { title: "Child", parent: "parent" }),
      real("g1", { title: "G one", parent: "child" }),
      real("g2", { title: "G two", parent: "child", status: "decided" }),
    );
    const out = (await w("show", "parent")).stdout;
    expect(out).toContain("rollup: 4 cards");
    const link = out.split("\n").find((l) => l.includes("<- refines"));
    expect(link).toBeDefined();
    expect(link).toContain("child");
    expect(link).toContain("rollup: 3 cards");
  });

  test("11.3 options, excerpts and a proposed source print with their words", async () => {
    seed(
      project,
      real("dep", { title: "Dependency" }),
      real("main", { title: "Main card" }),
      { type: "edge.added", from: "main", to: "dep", link: "depends_on", why: "needs the dependency" },
      ghost("opt", { kind: "option", title: "Option title", why: "too slow" }),
      { type: "node.accepted", id: "opt", actor: "you" },
      { type: "edge.added", from: "opt", to: "main", link: "alternative_to" },
      {
        type: "excerpt.quoted", id: "main:ex0", title: "exact verbatim words", card: "main",
        conversation: "talk", session: "s1", message: 1, start: 0, end: 5, speaker: "person", said_at: "10:02",
      },
      { type: "node.accepted", id: "main:ex0", actor: "you" },
      ghost("src", { kind: "source", title: "Source title", why: "the finding" }),
      { type: "edge.added", from: "main", to: "src", link: "supported_by" },
    );
    const out = (await w("show", "main")).stdout;
    expect(out).toContain("depends_on");
    expect(out).toContain("why: needs the dependency");
    const iLinks = out.indexOf("why: needs the dependency");
    const iOpt = out.indexOf("Options:");
    expect(iOpt).toBeGreaterThan(iLinks);
    expect(out).toContain("Option title");
    expect(out).toContain("why not: too slow");
    expect(out).toContain("Say:\n  person: exact verbatim words");
    const ev = out.slice(out.indexOf("Ev:"));
    expect(ev).toContain("Source title");
    expect(ev).toContain("finding: the finding");
    expect(ev).toContain("proposed");
  });

  test("11.4 no options means no Options section", async () => {
    seed(
      project,
      real("main", { title: "Main card" }),
      {
        type: "excerpt.quoted", id: "main:ex0", title: "words said", card: "main",
        conversation: "talk", session: "s1", message: 1, start: 0, end: 5, speaker: "person", said_at: "10:02",
      },
      { type: "node.accepted", id: "main:ex0", actor: "you" },
      ghost("src", { kind: "source", title: "Source title", why: "f" }),
      { type: "node.accepted", id: "src", actor: "you" },
      { type: "edge.added", from: "main", to: "src", link: "supported_by" },
    );
    const out = (await w("show", "main")).stdout;
    expect(out).toContain("Say:");
    expect(out).toContain("Ev:");
    expect(out).not.toContain("Options");
  });

  test("11.5 show with no id prints the root card", async () => {
    seed(
      project,
      real("root", { title: "The root" }),
      real("second", { title: "Second card", parent: "root" }),
      real("third", { title: "Third", parent: "second" }),
    );
    const r = await w("show");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("The root");
    expect(r.stdout).toContain("rollup: 3 cards");
    const l = r.stdout.split("\n").find((x) => x.includes("<- refines"));
    expect(l).toContain("second");
    expect(l).toContain("rollup: 2 cards");
  });
});
