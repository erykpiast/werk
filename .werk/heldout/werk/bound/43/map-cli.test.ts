import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { decidedCard, mkProj, openCard, type Proj } from "./helpers.ts";

let p: Proj;
beforeEach(() => {
  p = mkProj();
});
afterEach(() => p.dispose());

const ok = (r: { code: number; stdout: string; stderr: string }, what: string) =>
  expect(r.code, `${what}: code ${r.code}, stdout ${r.stdout}, stderr ${r.stderr}`).toBe(0);

describe("06 excerpts as ghosts", () => {
  test("06.1 a new excerpt stages as a ghost and waits for the check mark", () => {
    p.seed(...decidedCard("root", { title: "Root", why: "w", body: "Root words" }));
    const before = p.map().nodes.get("root");
    const add = p.run("add", "ex1", "--kind", "excerpt", "--title", "Ann said so", "--body", "we need it");
    ok(add, "add excerpt");
    expect(add.stdout.trim()).toBe("proposed");
    const link = p.run("link", "root", "ex1", "--type", "supported_by");
    ok(link, "link");
    const map = p.map();
    expect(map.nodes.get("ex1")?.proposed).toBe(true);
    expect(map.ghostEdges.some((e) => e.from === "root" && e.to === "ex1")).toBe(true);
    expect(map.edges.some((e) => e.to === "ex1")).toBe(false);
    expect(map.nodes.get("root")?.status).toBe("decided");
    expect(map.nodes.get("root")?.body).toBe(before?.body);
  });

  test("06.2 an accepted excerpt stops being a ghost and its link goes live", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    p.seed(
      { type: "node.proposed", id: "ex1", kind: "excerpt", title: "Ann said so", status: "open", body: "we need it" },
      { type: "edge.added", from: "root", to: "ex1", link: "supported_by" },
    );
    expect(p.map().nodes.get("ex1")?.proposed).toBe(true);
    const acc = p.run("accept", "ex1", "--actor", "you");
    ok(acc, "accept");
    const map = p.map();
    expect(map.nodes.get("ex1")?.proposed).toBe(false);
    expect(map.edges.some((e) => e.from === "root" && e.to === "ex1" && e.type === "supported_by")).toBe(true);
    expect(map.ghostEdges.length).toBe(0);
    const show = p.run("show", "root");
    ok(show, "show");
    expect(show.stdout).toMatch(/supported_by\s+ex1/);
    expect(show.stdout).not.toMatch(/ex1.*\[(proposed|held)\]/);
  });
});

describe("08 remove and restore", () => {
  function auth() {
    p.seed(...decidedCard("auth", { title: "Auth" }));
    p.seed(...openCard("login", { title: "Login", parent: "auth" }));
    p.seed(...openCard("session", { title: "Session", parent: "auth" }));
    p.seed(...openCard("audit", { title: "Audit" }));
    p.seed({ type: "edge.added", from: "login", to: "audit", link: "depends_on", why: "logs" });
  }

  test("08.1 removing a card takes its subtree out in one step, a restore brings it back", () => {
    auth();
    const n = p.events().length;
    ok(p.run("remove", "auth", "--actor", "you"), "remove");
    const map = p.map();
    for (const id of ["auth", "login", "session"]) expect(map.nodes.has(id)).toBe(false);
    expect(p.events().length).toBe(n + 1);
    const removed = p.run("removed");
    ok(removed, "removed");
    expect(removed.stdout).toContain("auth");
    expect(removed.stdout).toContain("login");
    expect(removed.stdout).toContain("session");
    expect(map.edges.some((e) => e.from === "login" && e.to === "audit")).toBe(false);
    ok(p.run("restore", "auth", "--actor", "you"), "restore");
    const back = p.map();
    expect(back.parents.get("login")).toBe("auth");
    expect(back.parents.get("session")).toBe("auth");
    expect(back.edges.some((e) => e.from === "login" && e.to === "audit")).toBe(true);
    expect(p.run("removed").stdout.trim()).toBe("");
  });

  test("08.2 removing with reparent moves the children up, a restore puts them back", () => {
    p.seed(...decidedCard("platform", { title: "Platform" }));
    p.seed(...decidedCard("auth", { title: "Auth", parent: "platform" }));
    p.seed(...openCard("login", { parent: "auth" }), ...openCard("session", { parent: "auth" }));
    ok(p.run("remove", "auth", "--actor", "you", "--reparent"), "remove reparent");
    let map = p.map();
    expect(map.nodes.has("auth")).toBe(false);
    expect(map.parents.get("login")).toBe("platform");
    expect(map.parents.get("session")).toBe("platform");
    ok(p.run("restore", "auth", "--actor", "you"), "restore");
    map = p.map();
    expect(map.parents.get("auth")).toBe("platform");
    expect(map.parents.get("login")).toBe("auth");
    expect(map.parents.get("session")).toBe("auth");
  });

  test("08.3 a link waits until both of its ends are back", () => {
    p.seed(...decidedCard("root"));
    p.seed(...openCard("b1", { parent: "root" }), ...openCard("b2", { parent: "root" }));
    p.seed(...openCard("login", { parent: "b1" }), ...openCard("session", { parent: "b2" }));
    p.seed({ type: "edge.added", from: "login", to: "session", link: "depends_on", why: "needs" });
    ok(p.run("remove", "login", "--actor", "you"), "remove login");
    ok(p.run("remove", "session", "--actor", "you"), "remove session");
    ok(p.run("restore", "login", "--actor", "you"), "restore login");
    let map = p.map();
    expect(map.nodes.has("login")).toBe(true);
    expect(map.edges.some((e) => e.from === "login" && e.to === "session")).toBe(false);
    ok(p.run("restore", "session", "--actor", "you"), "restore session");
    map = p.map();
    expect(map.edges.some((e) => e.from === "login" && e.to === "session")).toBe(true);
  });

  test("08.4 a removed card's id stays taken, and a cited source stays", () => {
    p.seed(...decidedCard("root"));
    p.seed(...openCard("login", { parent: "root" }), ...openCard("billing", { parent: "root" }));
    p.seed(...openCard("rfc-6749", { kind: "source", title: "RFC 6749" }));
    p.seed(
      { type: "edge.added", from: "login", to: "rfc-6749", link: "supported_by" },
      { type: "edge.added", from: "billing", to: "rfc-6749", link: "supported_by" },
    );
    ok(p.run("remove", "login", "--actor", "you"), "remove");
    const map = p.map();
    expect(map.nodes.has("rfc-6749")).toBe(true);
    expect(map.edges.some((e) => e.from === "billing" && e.to === "rfc-6749")).toBe(true);
    const add = p.run("add", "login", "--title", "Login again");
    expect(add.code).not.toBe(0);
    expect(add.stderr).toMatch(/restore/i);
    expect(add.stderr).toContain("login");
    expect(p.map().nodes.has("login")).toBe(false);
  });

  test("08.5 remove refuses without the person's say-so", () => {
    p.seed(...decidedCard("root"), ...openCard("login", { parent: "root" }));
    const n = p.events().length;
    const r = p.run("remove", "login");
    expect(r.code, `remove without --actor: ${r.stdout}${r.stderr}`).not.toBe(0);
    expect(p.map().nodes.has("login")).toBe(true);
    expect(p.events().length).toBe(n);
  });

  test("08.6 restore refuses without the person's say-so", () => {
    p.seed(...decidedCard("root"), ...openCard("login", { parent: "root" }));
    p.seed({ type: "node.removed", id: "login", actor: "you" });
    expect(p.map().nodes.has("login")).toBe(false);
    const n = p.events().length;
    const r = p.run("restore", "login");
    expect(r.code, `restore without --actor: ${r.stdout}${r.stderr}`).not.toBe(0);
    expect(p.map().nodes.has("login")).toBe(false);
    expect(p.events().length).toBe(n);
  });
});

describe("09 search and find", () => {
  test("09.1 an agent lists the index of decided cards", () => {
    p.seed(...decidedCard("d1", { title: "Decided one" }));
    p.seed(...decidedCard("d2", { title: "Decided two" }), ...decidedCard("d3", { title: "Decided three" }));
    p.seed(...openCard("o1", { title: "Open one" }));
    p.seed({ type: "node.proposed", id: "g1", kind: "card", title: "Ghost one", status: "decided" });
    const r = p.run("search");
    ok(r, "search");
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBe(3);
    for (const id of ["d1", "d2", "d3"]) expect(r.stdout).toContain(id);
    expect(r.stdout).not.toContain("o1");
    expect(r.stdout).not.toContain("g1");
  });

  test("09.2 an agent searches with two terms and sees the best match first", () => {
    p.seed(...decidedCard("layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }));
    p.seed(...openCard("timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }));
    p.seed(...decidedCard("size", { title: "Cache size", body: "cache" }));
    p.seed(...openCard("gone", { title: "cache eviction" }));
    p.seed({ type: "node.removed", id: "gone" });
    const r = p.run("search", "cache", "eviction");
    ok(r, "search");
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/layout.*decided.*Cache layout/);
    expect(lines[1]).toMatch(/timer.*open.*Eviction timer/);
  });

  test("09.3 an agent finds a card by a word in a rejected option and narrows the search", () => {
    p.seed(...decidedCard("parent", { title: "Parent topic" }));
    p.seed(...decidedCard("storage", { title: "Storage format", parent: "parent" }));
    p.seed(...openCard("storage:opt0", { kind: "option", title: "Use a database", why: "SQLite needs a native build" }));
    p.seed({ type: "edge.added", from: "storage:opt0", to: "storage", link: "alternative_to" });
    p.seed(...openCard("other", { title: "Other", body: "we could use sqlite" }));
    const all = p.run("search", "sqlite");
    ok(all, "search");
    expect(all.stdout).toContain("storage");
    expect(all.stdout).toContain("other");
    const under = p.run("search", "sqlite", "--under", "parent");
    ok(under, "under");
    expect(under.stdout.trim().split("\n").length).toBe(1);
    expect(under.stdout).toContain("storage");
    const decided = p.run("search", "sqlite", "--status", "decided");
    ok(decided, "status");
    expect(decided.stdout.trim().split("\n").length).toBe(1);
    expect(decided.stdout).toContain("storage");
  });

  test("09.4 an agent finds the open work under one card", () => {
    // The paused, stale and postponed marks have no event in the log that a test can write.
    p.seed(...decidedCard("client", { title: "Client" }));
    p.seed(...openCard("routing", { title: "Routing", parent: "client" }));
    p.seed(...openCard("theme", { title: "Theme", parent: "client", status: "proto" }));
    p.seed(...openCard("guards", { title: "Route guards", parent: "routing" }));
    p.seed(...openCard("billing", { title: "Billing" }));
    const r = p.run("find", "routing");
    ok(r, "find routing");
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toContain("routing");
    expect(lines[1]).toContain("guards");
    expect(r.stdout).not.toContain("billing");
    const c = p.run("find", "client");
    ok(c, "find client");
    expect(c.stdout.indexOf("theme")).toBeLessThan(c.stdout.indexOf("guards"));
    expect(c.stdout).not.toMatch(/^\S*client\b/m);
  });

  test("09.5 a card reopened as rejected comes back as work in every tree", () => {
    p.seed(...openCard("t1", { title: "Tree one" }), ...openCard("t2", { title: "Tree two" }));
    p.seed(...decidedCard("auth", { title: "Auth flow" }));
    const reopen = p.run("reopen", "auth", "--as", "rejected", "--actor", "you");
    ok(reopen, "reopen");
    const r = p.run("find");
    ok(r, "find");
    expect(r.stdout).toContain("t1");
    expect(r.stdout).toContain("t2");
    expect(r.stdout).toContain("auth");
  });
});

describe("11 show rollup", () => {
  /** A card decided before it gets its refines parent: a decided card needs a decided parent at the time. */
  function under(id: string, parent: string, status: "decided" | "open" | "proto") {
    if (status === "decided") {
      p.seed(...decidedCard(id, { title: id }));
      p.seed({ type: "edge.added", from: id, to: parent, link: "refines" });
    } else p.seed(...openCard(id, { title: id, parent, status }));
  }

  test("11.1 the rollup counts the card and its whole refines subtree", () => {
    p.seed(...decidedCard("root", { title: "Root" }));
    under("c1", "root", "open");
    under("c2", "root", "proto");
    under("g1", "c1", "decided");
    const r = p.run("show", "root");
    ok(r, "show");
    const rollup = r.stdout.split("\n").filter((l) => /\b4 cards\b/.test(l));
    expect(rollup.length, r.stdout).toBe(1);
    expect(rollup[0]).toMatch(/1 open/);
    expect(rollup[0]).toMatch(/1 proto/);
    expect(rollup[0]).toMatch(/2 decided/);
  });

  test("11.2 each incoming refines link shows the child's own rollup", () => {
    p.seed(...decidedCard("parent", { title: "Parent" }));
    under("child", "parent", "open");
    under("g1", "child", "open");
    under("g2", "child", "decided");
    const r = p.run("show", "parent");
    ok(r, "show");
    const link = r.stdout.split("\n").find((l) => /<-\s+refines\s+child/.test(l));
    expect(link, r.stdout).toMatch(/3 cards/);
    expect(r.stdout).toMatch(/\b4 cards\b/);
  });

  test("11.3 a card prints its options, excerpts and a proposed source with their words", () => {
    p.seed(...decidedCard("base", { title: "Base" }));
    p.seed(...decidedCard("c", { title: "The card" }));
    p.seed({ type: "edge.added", from: "c", to: "base", link: "depends_on", why: "needs the base" });
    p.seed(...openCard("c:opt0", { kind: "option", title: "Use files", why: "too slow" }));
    p.seed({ type: "edge.added", from: "c:opt0", to: "c", link: "alternative_to" });
    p.seed({ type: "node.proposed", id: "ex", kind: "excerpt", title: "Ann", status: "open", body: "exact words" });
    p.seed({ type: "node.proposed", id: "src", kind: "source", title: "A paper", status: "open", body: "the finding" });
    const r = p.run("show", "c");
    ok(r, "show");
    expect(r.stdout).toMatch(/depends_on\s+base.*\n?.*needs the base/);
    expect(r.stdout).toMatch(/Options/);
    expect(r.stdout).toMatch(/Say/);
    expect(r.stdout).toMatch(/\bEv\b/);
  });

  test("11.4 a card with no options prints no Options section", () => {
    p.seed(...decidedCard("c", { title: "The card" }));
    p.seed({ type: "node.proposed", id: "ex", kind: "excerpt", title: "Ann", status: "open", body: "exact words" });
    p.seed({ type: "node.proposed", id: "src", kind: "source", title: "A paper", status: "open", body: "the finding" });
    const r = p.run("show", "c");
    ok(r, "show");
    expect(r.stdout).toMatch(/Say/);
    expect(r.stdout).toMatch(/\bEv\b/);
    expect(r.stdout).not.toMatch(/Options/);
  });

  test("11.5 show with no id prints the root card", () => {
    p.seed(...decidedCard("root", { title: "The root title" }));
    p.seed(...openCard("second", { title: "Second", parent: "root" }));
    const r = p.run("show");
    ok(r, "show with no id");
    expect(r.stdout).toContain("The root title");
    expect(r.stdout).toMatch(/\b2 cards\b/);
    expect(r.stdout).toMatch(/<-\s+refines\s+second/);
  });
});
