import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProject,
  decided,
  ghost,
  link,
  open,
  type Project,
  refines,
  werkIn,
  writeLog,
} from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
};
const spoken = (text: string) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
});

describe("06 excerpt ghost", () => {
  test("06.1 a new excerpt stages as a ghost", async () => {
    writeLog(p, decided("x"));
    chat("pricing", spoken("we bill per seat"));
    const w = werkIn(p);
    const before = (await w("show", "x")).stdout;
    const r = await w("quote", "x", "pricing", "we bill per seat");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("proposed");
    expect(r.stdout).not.toContain("added");
    const ex = (await w("show", "x:ex0")).stdout;
    expect(ex).toContain("proposed");
    const card = (await w("show", "x")).stdout;
    expect(card).toContain("[decided]");
    expect(card).toMatch(/supported_by\s+x:ex0.*\[proposed\]/);
    expect(card).toContain("[held]");
    expect(card.split("\n")[0]).toBe(before.split("\n")[0]);
  });
  test("06.2 an accepted excerpt goes live", async () => {
    writeLog(p, decided("x"));
    chat("pricing", spoken("we bill per seat"));
    const w = werkIn(p);
    await w("quote", "x", "pricing", "we bill per seat");
    const a = await w("accept", "x:ex0", "--actor", "you");
    expect(a.code).toBe(0);
    const ex = (await w("show", "x:ex0")).stdout;
    expect(ex).not.toContain("proposed");
    const card = (await w("show", "x")).stdout;
    expect(card).toMatch(/supported_by\s+x:ex0/);
    expect(card).not.toContain("[held]");
    expect(card).not.toContain("[proposed]");
  });
});

const removedEvent = (id: string, extra = {}) => ({
  type: "node.removed",
  id,
  ...extra,
});

describe("08 remove and restore", () => {
  const tree = () => [
    ...decided("auth"),
    ...open("login"),
    refines("login", "auth"),
    ...open("session"),
    refines("session", "auth"),
    ...open("audit"),
    link("login", "audit"),
  ];
  test("08.1 remove takes the subtree out, restore brings it back", async () => {
    writeLog(p, tree());
    const w = werkIn(p);
    const n = p.events().length;
    const r = await w("remove", "auth", "--actor", "you");
    expect(r.code).toBe(0);
    expect(p.events().length).toBe(n + 1);
    for (const id of ["auth", "login", "session"])
      expect((await w("show", id)).code).not.toBe(0);
    const removed = await w("removed");
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("auth");
    expect(removed.stdout).toContain("login");
    expect(removed.stdout).toContain("session");
    expect((await w("show", "audit")).stdout).not.toContain("login");
    const back = await w("restore", "auth", "--actor", "you");
    expect(back.code).toBe(0);
    expect((await w("show", "auth")).stdout).toContain("login");
    expect((await w("show", "audit")).stdout).toContain("login");
    expect((await w("removed")).stdout.trim()).toBe("");
  });
  test("08.2 remove with reparent moves children up", async () => {
    writeLog(p, [
      ...decided("platform"),
      ...open("auth"),
      refines("auth", "platform"),
      ...open("login"),
      refines("login", "auth"),
      ...open("session"),
      refines("session", "auth"),
    ]);
    const w = werkIn(p);
    const r = await w("remove", "auth", "--actor", "you", "--reparent");
    expect(r.code).toBe(0);
    const plat = (await w("show", "platform")).stdout;
    expect(plat).not.toContain("auth");
    expect(plat).toContain("login");
    expect(plat).toContain("session");
    const back = await w("restore", "auth", "--actor", "you");
    expect(back.code).toBe(0);
    const plat2 = (await w("show", "platform")).stdout;
    expect(plat2).toContain("auth");
    expect(plat2).not.toContain("login");
    expect((await w("show", "auth")).stdout).toContain("login");
  });
  test("08.3 a link waits until both ends are back", async () => {
    writeLog(p, [
      ...open("login"),
      ...open("session"),
      link("login", "session"),
    ]);
    const w = werkIn(p);
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await w("remove", "session", "--actor", "you")).code).toBe(0);
    expect((await w("restore", "login", "--actor", "you")).code).toBe(0);
    expect((await w("show", "login")).stdout).not.toContain("session");
    expect((await w("restore", "session", "--actor", "you")).code).toBe(0);
    expect((await w("show", "login")).stdout).toContain("session");
  });
  test("08.4 a removed id stays taken, a cited source stays", async () => {
    writeLog(p, [
      ...open("login"),
      ...open("billing"),
      ghost("rfc-6749", { kind: "source" }),
      { type: "node.accepted", id: "rfc-6749", actor: "you" },
      link("login", "rfc-6749", "supported_by"),
      link("billing", "rfc-6749", "supported_by"),
    ]);
    const w = werkIn(p);
    expect((await w("remove", "login", "--actor", "you")).code).toBe(0);
    expect((await w("show", "rfc-6749")).stdout).toContain("billing");
    const n = p.events().length;
    const add = await w("add", "login", "--title", "New");
    expect(add.code).not.toBe(0);
    expect(add.stderr).toContain("restore");
    expect(add.stderr).toContain("login");
    expect(p.events().length).toBe(n);
  });
  test("08.5 remove refuses without --actor you", async () => {
    writeLog(p, open("login"));
    const w = werkIn(p);
    const n = p.events().length;
    const r = await w("remove", "login");
    expect(r.code).not.toBe(0);
    expect((await w("show", "login")).code).toBe(0);
    expect(p.events().length).toBe(n);
  });
  test("08.6 restore refuses without --actor you", async () => {
    writeLog(p, [...open("login"), removedEvent("login")]);
    const w = werkIn(p);
    const n = p.events().length;
    const r = await w("restore", "login");
    expect(r.code).not.toBe(0);
    expect((await w("show", "login")).code).not.toBe(0);
    expect(p.events().length).toBe(n);
  });
});

describe("09 search and find", () => {
  test("09.1 the index lists decided cards only", async () => {
    writeLog(p, [
      ...decided("d1"),
      ...decided("d2"),
      ...decided("d3"),
      ...open("o1"),
      ghost("g1"),
      { type: "node.edited", id: "g1", who: "me", noBasis: "t" },
      { type: "criterion.added", id: "g1", form: "revisit" },
      { type: "node.decided", id: "g1" },
    ]);
    const r = await werkIn(p)("search");
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(r.stdout).toContain("d1  Title d1");
    expect(r.stdout).not.toContain("o1");
    expect(r.stdout).not.toContain("g1");
  });
  test("09.2 two terms, best match first", async () => {
    writeLog(p, [
      ...decided("cache-layout", {
        title: "Cache layout",
        body: "Cache eviction and the eviction policy",
      }),
      ...open("eviction-timer", {
        title: "Eviction timer",
        why: "eviction",
        body: "CACHE warmup",
      }),
      ...decided("cache-size", { title: "Cache size", body: "cache" }),
      ...open("gone", { title: "Gone", body: "cache eviction" }),
      removedEvent("gone"),
    ]);
    const r = await werkIn(p)("search", "cache", "eviction");
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("cache-layout");
    expect(lines[0]).toContain("[decided]");
    expect(lines[0]).toContain("Cache layout");
    expect(lines[1]).toContain("eviction-timer");
    expect(lines[1]).toContain("[open]");
    expect(r.stdout).not.toContain("Cache size");
    expect(r.stdout).not.toContain("Gone");
  });
  test("09.3 a word in a rejected option, narrowed", async () => {
    writeLog(p, [
      ...decided("parent", { title: "Parent topic" }),
      ...decided("storage", { title: "Storage format" }),
      refines("storage", "parent"),
      ...open("opt", { kind: "option", why: "SQLite needs a native build" }),
      link("opt", "storage", "alternative_to"),
      ...open("elsewhere", { title: "Elsewhere", body: "sqlite" }),
    ]);
    const w = werkIn(p);
    const all = (await w("search", "sqlite")).stdout;
    expect(all).toContain("storage");
    expect(all).toContain("[decided]");
    expect(all).toContain("elsewhere");
    const under = (await w("search", "sqlite", "--under", "parent")).stdout;
    expect(under.trim().split("\n")).toHaveLength(1);
    expect(under).toContain("storage");
    const dec = (await w("search", "sqlite", "--status", "decided")).stdout;
    expect(dec.trim().split("\n")).toHaveLength(1);
    expect(dec).toContain("storage");
  });
  test("09.4 find lists the open work under a card", async () => {
    const card = (id: string, parent: string, extra = {}) => [
      ...open(id, extra),
      refines(id, parent),
    ];
    writeLog(p, [
      ...decided("client", { title: "Client" }),
      ...card("routing", "client", { title: "Routing" }),
      ...card("theme", "client", { title: "Theme", status: "proto" }),
      ...card("guards", "routing", { title: "Route guards" }),
      ...decided("pbase", { title: "PostponedCard" }),
      refines("pbase", "client"),
      ...card("paused", "client", { title: "PausedCard" }),
      link("paused", "pbase"),
      ...decided("sbase", { title: "StaleBase" }),
      ...card("stale", "client", { title: "StaleCard" }),
      link("stale", "sbase"),
      { type: "node.reopened", id: "pbase", at: "2026-10-10T09:00:00.000Z", reason: "postponed" },
      { type: "node.reopened", id: "sbase", at: "2026-10-10T09:00:00.000Z" },
      ...open("opt", { kind: "option", title: "OptionX" }),
      link("opt", "routing", "alternative_to"),
      ...open("src", { kind: "source", title: "SourceX" }),
      link("routing", "src", "supported_by"),
      ...open("billing", { title: "Billing" }),
    ]);
    const w = werkIn(p);
    const a = (await w("find", "routing")).stdout;
    expect(a.indexOf("Routing")).toBeGreaterThanOrEqual(0);
    expect(a.indexOf("Route guards")).toBeGreaterThan(a.indexOf("Routing"));
    for (const t of ["Billing", "OptionX", "SourceX"])
      expect(a).not.toContain(t);
    const b = (await w("find", "client")).stdout;
    expect(b.indexOf("Routing")).toBeLessThan(b.indexOf("Route guards"));
    expect(b.indexOf("Theme")).toBeLessThan(b.indexOf("Route guards"));
    expect(b).not.toMatch(/^client /m);
    for (const t of ["PausedCard", "StaleCard", "PostponedCard"])
      expect(b).not.toContain(t);
  });
  test("09.5 a reopened card is work in every tree", async () => {
    writeLog(p, [
      ...open("t1", { title: "Tree one" }),
      ...open("t2", { title: "Tree two" }),
      ...decided("auth", { title: "Auth flow" }),
      { type: "node.reopened", id: "auth", at: "2026-10-10T09:00:00.000Z" },
    ]);
    const r = await werkIn(p)("find");
    expect(r.stdout).toContain("Tree one");
    expect(r.stdout).toContain("Tree two");
    expect(r.stdout).toContain("Auth flow");
    expect(r.stdout).not.toContain("[decided]");
  });
});
