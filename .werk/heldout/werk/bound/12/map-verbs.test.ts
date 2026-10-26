/** Held-out steps 06, 08, 09 and 11: map verbs run through the command line. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "../src/test-env/project.ts";
import {
  decided,
  type Ev,
  link,
  logLines,
  newProject,
  real,
  seedLog,
  werkIn,
} from "./support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = newProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

const reopen = (id: string, reason = "invalidated"): Ev => ({
  type: "node.reopened",
  id,
  reason,
  at: "2026-10-10T09:00:00.000Z",
});
const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

describe("06 excerpt ghost", () => {
  test("06.1 a new excerpt for a decided card stages as a ghost", async () => {
    seedLog(project, decided("card"));
    const added = await werk(
      "add",
      "quote1",
      "--kind",
      "excerpt",
      "--title",
      "Ada said so",
      "--parent",
      "card",
    );
    expect(added.stderr).toBe("");
    expect(added.stdout.trim()).toBe("proposed");
    expect(added.code).toBe(0);
  });
});

describe("08 remove and restore", () => {
  const seedAuth = () =>
    seedLog(
      project,
      decided("auth"),
      real("login", { parent: "auth" }),
      real("session", { parent: "auth" }),
      real("audit"),
      link("login", "audit"),
    );

  test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
    seedAuth();
    const before = logLines(project).length;
    const removed = await werk("remove", "auth", "--actor", "you");
    expect(removed.stderr).toBe("");
    expect(removed.code).toBe(0);
    for (const id of ["auth", "login", "session"]) {
      expect((await werk("show", id)).code).toBe(1);
    }
    expect(logLines(project).length).toBe(before + 1);
    const list = await werk("removed");
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("auth");
    expect(list.stdout).toContain("login");
    expect(list.stdout).toContain("session");
    expect((await werk("show", "audit")).stdout).not.toContain("login");
    const restored = await werk("restore", "auth", "--actor", "you");
    expect(restored.code).toBe(0);
    expect((await werk("show", "auth")).stdout).toContain("login");
    expect((await werk("show", "auth")).stdout).toContain("session");
    expect((await werk("show", "audit")).stdout).toContain("login");
    expect((await werk("removed")).stdout.trim()).toBe("");
  });

  test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
    seedLog(
      project,
      decided("platform"),
      real("auth", { parent: "platform" }),
      real("login", { parent: "auth" }),
      real("session", { parent: "auth" }),
    );
    const removed = await werk(
      "remove",
      "auth",
      "--actor",
      "you",
      "--reparent",
    );
    expect(removed.stderr).toBe("");
    expect(removed.code).toBe(0);
    expect((await werk("show", "auth")).code).toBe(1);
    const platform = (await werk("show", "platform")).stdout;
    expect(platform).toContain("login");
    expect(platform).toContain("session");
    expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
    expect((await werk("show", "platform")).stdout).toContain("auth");
    expect((await werk("show", "platform")).stdout).not.toContain("login");
    expect((await werk("show", "auth")).stdout).toContain("login");
    expect((await werk("show", "auth")).stdout).toContain("session");
  });

  test("08.3 a link waits until both of its ends are back", async () => {
    seedLog(
      project,
      real("root"),
      real("a", { parent: "root" }),
      real("b", { parent: "root" }),
      real("login", { parent: "a" }),
      real("session", { parent: "b" }),
      link("login", "session"),
    );
    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await werk("remove", "session", "--actor", "you")).code).toBe(0);
    expect((await werk("restore", "login", "--actor", "you")).code).toBe(0);
    const login = await werk("show", "login");
    expect(login.code).toBe(0);
    expect(login.stdout).not.toContain("session");
    expect((await werk("restore", "session", "--actor", "you")).code).toBe(0);
    expect((await werk("show", "login")).stdout).toContain("session");
  });

  test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
    seedLog(
      project,
      real("login"),
      real("billing"),
      {
        type: "node.proposed",
        id: "rfc-6749",
        kind: "source",
        title: "OAuth RFC",
        status: "open",
      },
      { type: "node.accepted", id: "rfc-6749", actor: "you" },
      link("login", "rfc-6749", "supported_by"),
      link("billing", "rfc-6749", "supported_by"),
    );
    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    const billing = await werk("show", "billing");
    expect(billing.stdout).toContain("rfc-6749");
    const again = await werk("add", "login", "--title", "Login again");
    expect(again.code).not.toBe(0);
    expect(again.stderr).toContain("login");
    expect(again.stderr).toContain("restore");
    expect((await werk("show", "login")).code).toBe(1);
  });

  test("08.5 remove refuses without the person's say-so", async () => {
    seedLog(project, real("login"));
    const before = logLines(project);
    const removed = await werk("remove", "login");
    expect(removed.code).not.toBe(0);
    expect((await werk("show", "login")).code).toBe(0);
    expect(logLines(project)).toEqual(before);
  });

  test("08.6 restore refuses without the person's say-so", async () => {
    seedLog(project, real("login"));
    expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
    const before = logLines(project);
    const restored = await werk("restore", "login");
    expect(restored.code).not.toBe(0);
    expect((await werk("show", "login")).code).toBe(1);
    expect(logLines(project)).toEqual(before);
  });
});

describe("09 find and search", () => {
  test("09.1 an agent lists the index of decided cards", async () => {
    seedLog(
      project,
      decided("d1", { title: "First" }),
      decided("d2", { title: "Second" }),
      decided("d3", { title: "Third" }),
      real("o1", { title: "Still open" }),
      {
        type: "node.proposed",
        id: "g1",
        kind: "card",
        title: "Ghosted",
        status: "decided",
      },
    );
    const out = await werk("search");
    expect(out.code).toBe(0);
    expect(lines(out.stdout)).toHaveLength(3);
    for (const [id, title] of [
      ["d1", "First"],
      ["d2", "Second"],
      ["d3", "Third"],
    ] as const) {
      expect(out.stdout).toContain(id);
      expect(out.stdout).toContain(title);
    }
    expect(out.stdout).not.toContain("Still open");
    expect(out.stdout).not.toContain("Ghosted");
  });

  test("09.2 an agent searches with two terms and sees the best match first", async () => {
    seedLog(
      project,
      decided("layout", {
        title: "Cache layout",
        body: "Cache eviction runs on an eviction policy.",
      }),
      real("timer", {
        title: "Eviction timer",
        why: "eviction",
        body: "CACHE warmup",
      }),
      decided("size", { title: "Cache size", body: "cache only" }),
      real("gone", { title: "Old note", body: "cache eviction" }),
      { type: "node.removed", id: "gone" },
    );
    const out = await werk("search", "cache", "eviction");
    expect(out.code).toBe(0);
    const found = lines(out.stdout);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/layout\s+\[decided\]\s+Cache layout/);
    expect(found[1]).toMatch(/timer\s+\[open\]\s+Eviction timer/);
    expect(out.stdout).not.toContain("Cache size");
    expect(out.stdout).not.toContain("Old note");
  });

  test("09.3 an agent finds a card by a word in a rejected option and narrows the search", async () => {
    seedLog(
      project,
      decided("parent", { title: "Parent topic" }),
      real("storage", { title: "Storage format", parent: "parent" }),
      {
        type: "node.proposed",
        id: "storage:opt0",
        kind: "option",
        title: "Use a database",
        why: "SQLite needs a native build",
        status: "open",
      },
      { type: "node.accepted", id: "storage:opt0", actor: "you" },
      link("storage:opt0", "storage", "alternative_to"),
      { type: "node.edited", id: "storage", who: "you", noBasis: "test" },
      { type: "criterion.added", id: "storage", form: "revisit" },
      { type: "node.decided", id: "storage" },
      real("other", { title: "Elsewhere", body: "we may use sqlite" }),
    );
    const all = await werk("search", "sqlite");
    expect(all.code).toBe(0);
    expect(all.stdout).toMatch(/storage\s+\[decided\]\s+Storage format/);
    expect(all.stdout).toMatch(/other\s+\[open\]\s+Elsewhere/);
    const under = await werk("search", "sqlite", "--under", "parent");
    expect(lines(under.stdout)).toHaveLength(1);
    expect(under.stdout).toContain("Storage format");
    const status = await werk("search", "sqlite", "--status", "decided");
    expect(lines(status.stdout)).toHaveLength(1);
    expect(status.stdout).toContain("Storage format");
  });

  test("09.4 an agent finds the open work under one card", async () => {
    seedLog(
      project,
      decided("client", { title: "Client" }),
      real("routing", { title: "Routing", parent: "client" }),
      real("theme", { title: "Theme", parent: "client", status: "proto" }),
      real("guards", { title: "Route guards", parent: "routing" }),
      // paused: it depends on a card that is later postponed
      real("waits", { title: "Waits", parent: "client" }),
      // postponed: a decided card that is reopened as postponed
      decided("late", { title: "Late", parent: "client" }),
      link("waits", "late"),
      reopen("late", "postponed"),
      // stale: it depends on a decided card that is later reopened
      decided("base", { title: "Base" }),
      real("stale", { title: "Stale", parent: "client" }),
      link("stale", "base"),
      reopen("base"),
      // an option and a source on Routing
      {
        type: "node.proposed",
        id: "routing:opt0",
        kind: "option",
        title: "Hash routes",
        why: "no",
        status: "open",
      },
      { type: "node.accepted", id: "routing:opt0", actor: "you" },
      link("routing:opt0", "routing", "alternative_to"),
      {
        type: "node.proposed",
        id: "src",
        kind: "source",
        title: "Router docs",
        status: "open",
      },
      { type: "node.accepted", id: "src", actor: "you" },
      link("routing", "src", "supported_by"),
      real("billing", { title: "Billing" }),
    );
    const marks = (await werk("show", "waits")).stdout;
    expect(marks).toContain("PAUSED");
    expect((await werk("show", "stale")).stdout).toContain("STALE");
    expect((await werk("show", "late")).stdout).toContain("POSTPONED");

    const routing = await werk("find", "routing");
    expect(routing.code).toBe(0);
    const r = lines(routing.stdout);
    expect(r[0]).toContain("Routing");
    expect(r[1]).toContain("Route guards");
    for (const word of ["Billing", "Hash routes", "Router docs"]) {
      expect(routing.stdout).not.toContain(word);
    }
    const client = await werk("find", "client");
    expect(client.code).toBe(0);
    const c = lines(client.stdout);
    const at = (word: string) => c.findIndex((l) => l.includes(word));
    expect(at("Routing")).toBeGreaterThanOrEqual(0);
    expect(at("Theme")).toBeGreaterThanOrEqual(0);
    expect(at("Route guards")).toBeGreaterThan(at("Routing"));
    expect(at("Route guards")).toBeGreaterThan(at("Theme"));
    expect(c.some((l) => l.includes("[decided]"))).toBe(false);
    expect(client.stdout).not.toContain("Waits");
    expect(client.stdout).not.toContain("Late");
    expect(client.stdout).not.toContain("Stale");
  });

  test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
    seedLog(
      project,
      real("tree1", { title: "Tree one" }),
      real("tree2", { title: "Tree two" }),
      decided("auth", { title: "Auth flow" }),
      reopen("auth", "rejected"),
    );
    const out = await werk("find");
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Tree one");
    expect(out.stdout).toContain("Tree two");
    expect(out.stdout).toContain("Auth flow");
    expect(out.stdout).not.toContain("[decided]");
  });
});

describe("11 show rollups and evidence", () => {
  test("11.1 the rollup counts the card and its whole refines subtree", async () => {
    seedLog(
      project,
      decided("root"),
      decided("c1", { parent: "root" }),
      real("c2", { parent: "root", status: "proto" }),
      decided("g1", { parent: "c1" }),
      reopen("c1"),
    );
    const out = (await werk("show", "root")).stdout;
    const rollup = lines(out).filter((l) => /\b4 cards\b/.test(l));
    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatch(/1 open/);
    expect(rollup[0]).toMatch(/1 proto/);
    expect(rollup[0]).toMatch(/2 decided/);
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    seedLog(
      project,
      decided("parent"),
      decided("child", { parent: "parent" }),
      real("g1", { parent: "child" }),
      decided("g2", { parent: "child" }),
      reopen("child"),
    );
    const out = lines((await werk("show", "parent")).stdout);
    const row = out.find((l) => l.includes("<-") && l.includes("child"));
    expect(row).toBeDefined();
    expect(`${row}\n${out[out.indexOf(row as string) + 1]}`).toMatch(
      /\b3 cards\b/,
    );
    expect(out.filter((l) => /\b4 cards\b/.test(l))).toHaveLength(1);
  });

  test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
    seedLog(
      project,
      decided("base", { title: "Base" }),
      real("x", { title: "The card" }),
      {
        type: "edge.added",
        from: "x",
        to: "base",
        link: "depends_on",
        why: "it needs the base",
      },
      {
        type: "node.proposed",
        id: "x:opt0",
        kind: "option",
        title: "Option title",
        why: "Option why-not",
        status: "open",
      },
      { type: "node.accepted", id: "x:opt0", actor: "you" },
      link("x:opt0", "x", "alternative_to"),
      // No verb adds an excerpt, so the log holds it.
      {
        type: "node.proposed",
        id: "q1",
        kind: "excerpt",
        title: "Ada",
        body: "Exact words of Ada",
        speaker: "Ada",
        status: "open",
      },
      { type: "node.accepted", id: "q1", actor: "you" },
      link("x", "q1", "supported_by"),
      {
        type: "node.proposed",
        id: "s1",
        kind: "source",
        title: "Source title",
        body: "Source finding",
        status: "open",
      },
      link("x", "s1", "supported_by"),
    );
    const out = (await werk("show", "x")).stdout;
    expect(out).toContain("it needs the base");
    expect(out).toMatch(/^Options/m);
    expect(out).toContain("Option title");
    expect(out).toContain("Option why-not");
    expect(out).toMatch(/^Say/m);
    expect(out).toContain("Ada");
    expect(out).toContain("Exact words of Ada");
    expect(out).toMatch(/^Ev/m);
    expect(out).toContain("Source title");
    expect(out).toContain("Source finding");
    expect(out).toContain("proposed");
  });

  test("11.4 a card with no options prints no Options section", async () => {
    seedLog(
      project,
      real("x", { title: "The card" }),
      {
        type: "node.proposed",
        id: "q1",
        kind: "excerpt",
        title: "Ada",
        body: "Exact words of Ada",
        speaker: "Ada",
        status: "open",
      },
      { type: "node.accepted", id: "q1", actor: "you" },
      link("x", "q1", "supported_by"),
      {
        type: "node.proposed",
        id: "s1",
        kind: "source",
        title: "Source title",
        body: "Source finding",
        status: "open",
      },
      { type: "node.accepted", id: "s1", actor: "you" },
      link("x", "s1", "supported_by"),
    );
    const out = (await werk("show", "x")).stdout;
    expect(out).toMatch(/^Say/m);
    expect(out).toMatch(/^Ev/m);
    expect(out).not.toMatch(/^Options/m);
  });

  test("11.5 show with no id prints the root card", async () => {
    seedLog(
      project,
      real("root", { title: "The root" }),
      real("second", { title: "Second", parent: "root" }),
    );
    const out = await werk("show");
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("The root");
    expect(out.stdout).toMatch(/\b2 cards\b/);
    expect(out.stdout).toContain("second");
  });
});
