import { describe, expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { card, ghost, link, mapLog, ok, werk, ev } from "./lib.ts";

const project = useProject();
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

describe("08 remove and restore", () => {
  test("08.1 removing a card takes its subtree out in one step, a restore brings it back", async () => {
    const p = project();
    card(p, "auth", "Auth", { status: "decided" });
    card(p, "login", "Login", { parent: "auth" });
    card(p, "session", "Session", { parent: "auth" });
    card(p, "audit", "Audit");
    link(p, "login", "audit", "depends_on", "audit trail");
    const before = mapLog(p).split("\n").filter(Boolean).length;
    const rm = await werk(p, "remove", "auth", "--actor", "you");
    expect(rm.stderr).toBe("");
    expect(rm.code).toBe(0);
    const removedEvents = mapLog(p).split("\n").filter(Boolean).length - before;
    expect(removedEvents).toBe(1);
    for (const id of ["auth", "login", "session"]) {
      expect((await werk(p, "show", id)).code).not.toBe(0);
    }
    const removed = await werk(p, "removed");
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("auth");
    expect(removed.stdout).toContain("login");
    expect(removed.stdout).toContain("session");
    expect((await werk(p, "show", "audit")).stdout).not.toContain("login");
    expect((await werk(p, "restore", "auth", "--actor", "you")).code).toBe(0);
    const login = (await werk(p, "show", "login")).stdout;
    expect(login).toContain("audit");
    expect((await werk(p, "removed")).stdout.trim()).toBe("");
  });

  test("08.2 removing with reparent moves the children up, restore puts them back", async () => {
    const p = project();
    card(p, "platform", "Platform", { status: "decided" });
    card(p, "auth", "Auth", { parent: "platform" });
    card(p, "login", "Login", { parent: "auth" });
    card(p, "session", "Session", { parent: "auth" });
    const rm = await werk(p, "remove", "auth", "--actor", "you", "--reparent");
    expect(rm.stderr).toBe("");
    expect(rm.code).toBe(0);
    expect((await werk(p, "show", "auth")).code).not.toBe(0);
    const platform = (await werk(p, "show", "platform")).stdout;
    expect(platform).toContain("login");
    expect(platform).toContain("session");
    expect((await werk(p, "restore", "auth", "--actor", "you")).code).toBe(0);
    const after = (await werk(p, "show", "platform")).stdout;
    expect(after).toContain("auth");
    expect(after).not.toMatch(/<- refines\s+login/);
    expect((await werk(p, "show", "auth")).stdout).toMatch(/<- refines\s+login/);
  });

  test("08.3 a link waits until both of its ends are back", async () => {
    const p = project();
    card(p, "a", "Branch A");
    card(p, "b", "Branch B");
    card(p, "login", "Login", { parent: "a" });
    card(p, "session", "Session", { parent: "b" });
    link(p, "login", "session", "depends_on", "needs it");
    await ok(p, "remove", "login", "--actor", "you");
    await ok(p, "remove", "session", "--actor", "you");
    await ok(p, "restore", "login", "--actor", "you");
    const login = (await werk(p, "show", "login")).stdout;
    expect(login).toContain("Login");
    expect(login).not.toMatch(/-> depends_on\s+session/);
    await ok(p, "restore", "session", "--actor", "you");
    expect((await werk(p, "show", "login")).stdout).toMatch(/-> depends_on\s+session/);
  });

  test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
    const p = project();
    card(p, "login", "Login");
    card(p, "billing", "Billing");
    card(p, "rfc-6749", "RFC 6749", { kind: "source" });
    link(p, "login", "rfc-6749", "supported_by");
    link(p, "billing", "rfc-6749", "supported_by");
    await ok(p, "remove", "login", "--actor", "you");
    const src = await werk(p, "show", "rfc-6749");
    expect(src.code).toBe(0);
    expect(src.stdout).toContain("billing");
    const add = await werk(p, "add", "login", "--title", "New login");
    expect(add.code).not.toBe(0);
    expect(add.stderr).toMatch(/restore/);
    expect(add.stderr).toContain("login");
    expect((await werk(p, "show", "login")).code).not.toBe(0);
  });

  test("08.5 remove refuses without --actor you", async () => {
    const p = project();
    card(p, "login", "Login");
    const before = mapLog(p);
    const rm = await werk(p, "remove", "login");
    expect(rm.code).not.toBe(0);
    expect((await werk(p, "show", "login")).code).toBe(0);
    expect(mapLog(p)).toBe(before);
  });

  test("08.6 restore refuses without --actor you", async () => {
    const p = project();
    card(p, "login", "Login");
    await ok(p, "remove", "login", "--actor", "you");
    const before = mapLog(p);
    const rs = await werk(p, "restore", "login");
    expect(rs.code).not.toBe(0);
    expect((await werk(p, "show", "login")).code).not.toBe(0);
    expect(mapLog(p)).toBe(before);
  });
});

describe("09 search and find", () => {
  test("09.1 the index of decided cards", async () => {
    const p = project();
    card(p, "d1", "Decided one", { status: "decided" });
    card(p, "d2", "Decided two", { status: "decided" });
    card(p, "d3", "Decided three", { status: "decided" });
    card(p, "o1", "Open one");
    ghost(p, "g1", "Ghost decided", { status: "decided" });
    const r = await ok(p, "search");
    const out = lines(r.stdout);
    expect(out).toHaveLength(3);
    for (const [id, t] of [["d1", "Decided one"], ["d2", "Decided two"], ["d3", "Decided three"]]) {
      expect(out.some((l) => l.includes(id as string) && l.includes(t as string))).toBe(true);
    }
    expect(r.stdout).not.toContain("Open one");
    expect(r.stdout).not.toContain("Ghost decided");
  });

  test("09.2 two terms, best match first", async () => {
    const p = project();
    card(p, "layout", "Cache layout", { status: "decided", body: "Cache eviction and the eviction policy" });
    card(p, "timer", "Eviction timer", { why: "eviction", body: "CACHE warmup" });
    card(p, "size", "Cache size", { status: "decided", body: "cache only" });
    card(p, "gone", "Gone card", { body: "cache eviction" });
    await ok(p, "remove", "gone", "--actor", "you").catch(() => undefined);
    const removed = await werk(p, "remove", "gone");
    void removed;
    const r = await ok(p, "search", "cache", "eviction");
    const out = lines(r.stdout);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("layout");
    expect(out[0]).toContain("decided");
    expect(out[0]).toContain("Cache layout");
    expect(out[1]).toContain("timer");
    expect(out[1]).toContain("open");
    expect(r.stdout).not.toContain("Cache size");
    expect(r.stdout).not.toContain("Gone card");
  });

  test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
    const p = project();
    card(p, "parent", "Parent topic", { status: "decided" });
    card(p, "storage", "Storage format", { parent: "parent", status: "decided" });
    card(p, "opt", "Use a database", { kind: "option", why: "SQLite needs a native build" });
    link(p, "opt", "storage", "alternative_to");
    card(p, "other", "Other open card", { body: "sqlite is mentioned" });
    const all = await ok(p, "search", "sqlite");
    expect(all.stdout).toContain("Storage format");
    expect(all.stdout).toMatch(/storage\s+\[decided\]/);
    expect(all.stdout).toContain("Other open card");
    const under = await ok(p, "search", "sqlite", "--under", "parent");
    expect(lines(under.stdout)).toHaveLength(1);
    expect(under.stdout).toContain("Storage format");
    const dec = await ok(p, "search", "sqlite", "--status", "decided");
    expect(lines(dec.stdout)).toHaveLength(1);
    expect(dec.stdout).toContain("Storage format");
  });

  test("09.4 the open work under one card", async () => {
    const p = project();
    card(p, "client", "Client", { status: "decided" });
    card(p, "routing", "Routing", { parent: "client" });
    card(p, "theme", "Theme", { parent: "client", status: "proto" });
    card(p, "guards", "Route guards", { parent: "routing" });
    card(p, "basis", "Basis", { status: "decided" });
    card(p, "paused", "Paused card", { parent: "client" });
    card(p, "stale", "Stale card", { parent: "client", status: "decided" });
    card(p, "post", "Postponed card", { parent: "client", status: "decided" });
    link(p, "paused", "basis", "depends_on", "needs");
    link(p, "stale", "basis", "depends_on", "needs");
    await ok(p, "reopen", "basis", "--reason", "invalidated");
    await ok(p, "reopen", "stale", "--reason", "invalidated");
    await ok(p, "reopen", "post", "--reason", "postponed");
    card(p, "opt", "An option", { kind: "option", parent: undefined });
    link(p, "opt", "routing", "alternative_to");
    card(p, "src", "A source", { kind: "source" });
    link(p, "routing", "src", "supported_by");
    card(p, "billing", "Billing");
    const r = await ok(p, "find", "routing");
    const ids = lines(r.stdout).map((l) => l.split(/\s+/)[0]);
    expect(ids).toEqual(["routing", "guards"]);
    const c = await ok(p, "find", "client");
    const cids = lines(c.stdout).map((l) => l.split(/\s+/)[0]);
    expect(cids.slice(0, 3).sort()).toEqual(["guards", "routing", "theme"].sort());
    expect(cids.indexOf("routing")).toBeLessThan(cids.indexOf("guards"));
    expect(cids.indexOf("theme")).toBeLessThan(cids.indexOf("guards"));
    for (const id of ["client", "paused", "stale", "post", "billing", "opt", "src"]) expect(cids).not.toContain(id);
  });

  test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
    const p = project();
    card(p, "t1", "Tree one");
    card(p, "t2", "Tree two");
    card(p, "auth", "Auth flow", { status: "decided" });
    await ok(p, "reopen", "auth", "--reason", "rejected");
    const r = await ok(p, "find");
    expect(r.stdout).toContain("Tree one");
    expect(r.stdout).toContain("Tree two");
    expect(r.stdout).toContain("Auth flow");
    expect(r.stdout).not.toContain("[decided]");
  });
});

describe("11 show", () => {
  test("11.1 the rollup counts the card and its refines subtree", async () => {
    const p = project();
    card(p, "root", "Root", { status: "decided" });
    card(p, "c1", "Child open", { parent: "root" });
    card(p, "c2", "Child proto", { parent: "root", status: "proto" });
    card(p, "g", "Grandchild", { parent: "c1", status: "decided" });
    const out = (await ok(p, "show", "root")).stdout;
    const roll = lines(out).filter((l) => /rollup|cards?\b/i.test(l) && /\b4\b/.test(l));
    expect(roll).toHaveLength(1);
    expect(roll[0]).toMatch(/1 open/);
    expect(roll[0]).toMatch(/1 proto/);
    expect(roll[0]).toMatch(/2 decided/);
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    const p = project();
    card(p, "parent", "Parent", { status: "decided" });
    card(p, "child", "Child", { parent: "parent" });
    card(p, "g1", "Grand open", { parent: "child" });
    card(p, "g2", "Grand decided", { parent: "child", status: "decided" });
    const out = (await ok(p, "show", "parent")).stdout;
    const l = lines(out);
    const childRow = l.find((x) => /<- refines\s+child/.test(x));
    expect(childRow).toBeDefined();
    expect(childRow).toMatch(/3 cards/);
    expect(l.some((x) => /4 cards/.test(x))).toBe(true);
  });

  const withExtras = async (p: ReturnType<typeof project>, opts: { options: boolean }) => {
    card(p, "base", "Base card", { status: "decided" });
    card(p, "main", "Main card");
    link(p, "main", "base", "depends_on", "it needs the base");
    if (opts.options) {
      card(p, "opt", "Use a queue", { kind: "option", why: "A queue loses order" });
      link(p, "opt", "main", "alternative_to");
    }
    card(p, "ex", "Priya", { kind: "excerpt", why: "Priya", body: "We never sell per seat." });
    link(p, "main", "ex", "supported_by");
    ghost(p, "src", "Pricing study", { kind: "source", why: "Seats beat usage by 3x" });
    link(p, "main", "src", "supported_by");
  };

  test("11.3 a card prints its options, excerpts and a proposed source", async () => {
    const p = project();
    await withExtras(p, { options: true });
    const out = (await ok(p, "show", "main")).stdout;
    expect(out).toContain("it needs the base");
    expect(out).toMatch(/Options/);
    expect(out).toContain("A queue loses order");
    expect(out).toMatch(/Say/);
    expect(out).toContain("We never sell per seat.");
    expect(out).toMatch(/Ev/);
    expect(out).toContain("Pricing study");
    expect(out).toContain("Seats beat usage by 3x");
    expect(out.indexOf("Options")).toBeGreaterThan(out.indexOf("depends_on"));
  });

  test("11.4 a card with no options prints no Options section", async () => {
    const p = project();
    await withExtras(p, { options: false });
    const out = (await ok(p, "show", "main")).stdout;
    expect(out).toMatch(/Say/);
    expect(out).toMatch(/Ev/);
    expect(out).not.toMatch(/Options/);
  });

  test("11.5 show with no id prints the root card", async () => {
    const p = project();
    card(p, "root", "The root card", { status: "decided" });
    card(p, "second", "Second card", { parent: "root" });
    const r = await werk(p, "show");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("The root card");
    expect(r.stdout).toMatch(/2 cards/);
    expect(r.stdout).toMatch(/<- refines\s+second/);
  });
});

describe("06 excerpts as ghosts", () => {
  test("06.1 a new excerpt stages as a ghost waiting for the accept", async () => {
    const p = project();
    card(p, "c", "Decided card", { status: "decided", why: "the why" });
    const r = await werk(p, "add", "ex1", "--title", "Priya", "--kind", "excerpt", "--body", "We never sell per seat.");
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("proposed");
    const l = await ok(p, "link", "c", "ex1", "--type", "supported_by");
    void l;
    const show = (await ok(p, "show", "ex1")).stdout;
    expect(show).toContain("proposed");
    const cardShow = (await ok(p, "show", "c")).stdout;
    expect(cardShow).toMatch(/held|proposed/);
    expect(cardShow).toContain("[decided]");
  });

  test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
    const p = project();
    card(p, "c", "Decided card", { status: "decided" });
    const added = await werk(p, "add", "ex1", "--title", "Priya", "--kind", "excerpt", "--body", "We never sell per seat.");
    expect(added.code).toBe(0);
    await ok(p, "link", "c", "ex1", "--type", "supported_by");
    await ok(p, "accept", "ex1", "--actor", "you");
    const show = (await ok(p, "show", "ex1")).stdout;
    expect(show).not.toContain("proposed");
    const cardShow = (await ok(p, "show", "c")).stdout;
    expect(cardShow).not.toMatch(/\[held\]/);
    expect(cardShow).toMatch(/supported_by\s+ex1/);
  });
});
