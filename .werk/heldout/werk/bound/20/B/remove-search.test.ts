// Held-out tests for steps 08.x, 09.x and 66.x: remove, restore, removed, search and find,
// at the command line on a fresh project.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

type Payload = Record<string, unknown>;
type Ev = [type: string, payload: Payload];

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function withMap(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) =>
    JSON.stringify({ seq: i + 1, at: "2026-10-01T09:00:00Z", actor: "you", type, payload }),
  );
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}
const card = (id: string, title: string, parent?: string, extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, status: "decided", who: "me", ...(parent ? { parent } : {}), ...extra },
];
const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why ? { why } : {}) },
];
const reopen = (id: string, reason: string): Ev => ["node.reopened", { id, reason, why: `${reason} it` }];

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const shown = async (p: Project, id: string) => {
  const r = await p.werk(["show", id]);
  return { ...r, all: r.out + r.err };
};

// ---------- 08 ----------

test("08.1 remove takes the subtree out in one event, restore brings everything back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Authentication", "root"),
    card("login", "Login form", "auth"),
    card("session", "Session cookie", "auth"),
    card("audit", "Audit trail", "root"),
    link("login", "audit", "depends_on", "Login writes the audit trail"),
  ]);
  const before = lines(p);
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) {
    expect((await p.werk(["show", id])).code).not.toBe(0);
    for (const view of [["show", "root"], ["search"], ["find"], ["show", "audit"]]) {
      expect((await ok(p, view)).out).not.toContain(`${id}  `);
    }
  }
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
  expect(JSON.parse(after.at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");

  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("login");
  expect((await ok(p, ["show", "auth"])).out).toContain("session");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, 60_000);

test("08.2 remove with reparent moves children up, restore puts them back", async () => {
  const p = withMap([
    card("platform", "Platform"),
    card("auth", "Authentication", "platform"),
    card("login", "Login form", "auth"),
    card("session", "Session cookie", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).not.toBe(0);
  expect((await ok(p, ["show", "platform"])).out).not.toContain("auth");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const platform = (await ok(p, ["show", "platform"])).out;
  expect(platform).not.toContain("login");
  expect(platform).not.toContain("session");
}, 60_000);

test("08.3 a link waits until both of its ends are back", async () => {
  const p = withMap([
    card("root", "Root"),
    card("front", "Front end", "root"),
    card("back", "Back end", "root"),
    card("login", "Login form", "front"),
    card("session", "Session cookie", "back"),
    link("login", "session", "depends_on", "Login opens a session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const login = (await ok(p, ["show", "login"])).out;
  expect(login).not.toContain("session");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("session");
  expect((await ok(p, ["show", "session"])).out).toContain("login");
}, 60_000);

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login form", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0 RFC" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = (await ok(p, ["show", "rfc-6749"])).out;
  expect(src).toContain("billing");
  const count = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "A new login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.out + add.err).toMatch(/restore #?login/);
  expect(lines(p)).toHaveLength(count);
  expect(lines(p).some((l) => l.includes('"node.proposed"'))).toBe(false);
}, 60_000);

test("08.5 remove refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login form", "root")]);
  const before = lines(p);
  const run = await p.werk(["remove", "login"]);
  expect(run.code).not.toBe(0);
  expect((await ok(p, ["show", "login"])).out).toContain("Login form");
  expect((await ok(p, ["show", "root"])).out).toContain("login");
  expect(lines(p)).toEqual(before);
});

test("08.6 restore refuses without --actor you", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login form", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["restore", "login"]);
  expect(run.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).not.toBe(0);
  expect((await ok(p, ["show", "root"])).out).not.toContain("login");
  expect(lines(p)).toEqual(before);
});

// ---------- 09 ----------

test("09.1 search with no term lists the decided cards only", async () => {
  const p = withMap([
    card("root", "Root"),
    card("alpha", "Alpha decision", "root"),
    card("beta", "Beta decision", "root"),
    card("open1", "Open question", "root", { status: "open" }),
    ["node.proposed", { id: "ghosty", kind: "card", title: "Ghost decision", parent: "root", status: "decided" }],
  ]);
  const out = (await ok(p, ["search"])).out;
  const rows = out.split("\n").filter(Boolean);
  expect(rows).toEqual(["root  Root", "alpha  Alpha decision", "beta  Beta decision"]);
  expect(out).not.toContain("open1");
  expect(out).not.toContain("ghosty");
});

test("09.2 search with two terms, best match first", async () => {
  const p = withMap([
    card("root", "Root", undefined, { status: "open" }),
    card("cache-layout", "Cache layout", "root", {
      body: "Cache eviction runs hourly. The eviction policy is LRU.",
    }),
    card("eviction-timer", "Eviction timer", "root", {
      status: "open",
      why: "The eviction must run on time.",
      body: "It also does CACHE warmup.",
    }),
    card("cache-size", "Cache size", "root", { body: "The cache holds one gigabyte." }),
    card("gone", "Old card", "root", { body: "A cache eviction rule." }),
    ["node.removed", { id: "gone" }],
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  const rows = out.split("\n").filter(Boolean);
  expect(rows).toEqual(["cache-layout  decided  Cache layout", "eviction-timer  open  Eviction timer"]);
  expect(out).not.toContain("cache-size");
  expect(out).not.toContain("gone");
});

test("09.3 search finds a word in a rejected option and narrows", async () => {
  const p = withMap([
    card("root", "Root", undefined, { status: "open" }),
    card("parent-topic", "Parent topic", "root"),
    card("storage-format", "Storage format", "parent-topic"),
    [
      "node.added",
      {
        id: "storage-format:opt0",
        kind: "option",
        title: "An embedded database",
        why_not: "SQLite needs a native build",
      },
    ],
    link("storage-format:opt0", "storage-format", "alternative_to"),
    card("elsewhere", "Elsewhere", "root", { status: "open", body: "We could try sqlite here." }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out;
  expect(all).toContain("storage-format  decided  Storage format");
  expect(all).toContain("elsewhere  open  Elsewhere");
  const under = (await ok(p, ["search", "sqlite", "--under", "parent-topic"])).out;
  expect(under.split("\n").filter(Boolean)).toEqual(["storage-format  decided  Storage format"]);
  const decided = (await ok(p, ["search", "sqlite", "--status", "decided"])).out;
  expect(decided.split("\n").filter(Boolean)).toEqual(["storage-format  decided  Storage format"]);
});

test("09.4 find lists the open work under one card", async () => {
  const p = withMap([
    card("client", "Client"),
    card("routing", "Routing", "client", { status: "open" }),
    card("theme", "Theme", "client", { status: "proto" }),
    card("route-guards", "Route guards", "routing", { status: "open" }),
    card("infra", "Infra"),
    card("base-p", "Base postponed", "infra"),
    card("base-r", "Base rejected", "infra"),
    card("paused-card", "Paused card", "client", { status: "open" }),
    card("stale-card", "Stale card", "client", { status: "open" }),
    card("postponed-card", "Postponed card", "client"),
    link("paused-card", "base-p", "depends_on", "needs it"),
    link("stale-card", "base-r", "depends_on", "needs it"),
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "Ugly" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "router-docs", kind: "source", title: "Router docs" }],
    link("routing", "router-docs", "supported_by"),
    card("billing-root", "Billing tree"),
    card("billing", "Billing", "billing-root", { status: "open" }),
    reopen("base-p", "postponed"),
    reopen("base-r", "rejected"),
    reopen("postponed-card", "postponed"),
  ]);
  const r = (await ok(p, ["find", "routing"])).out;
  const ids = r
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(ids).toEqual(["routing", "route-guards"]);
  expect(r).not.toContain("billing");
  expect(r).not.toContain("opt0");
  expect(r).not.toContain("router-docs");
  const c = (await ok(p, ["find", "client"])).out;
  const cids = c
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(cids.indexOf("routing")).toBeGreaterThanOrEqual(0);
  expect(cids.indexOf("theme")).toBeGreaterThanOrEqual(0);
  expect(cids.indexOf("routing")).toBeLessThan(cids.indexOf("route-guards"));
  expect(cids.indexOf("theme")).toBeLessThan(cids.indexOf("route-guards"));
  for (const id of ["client", "paused-card", "stale-card", "postponed-card"]) expect(cids).not.toContain(id);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  const p = withMap([
    card("tree-a", "Tree A"),
    card("open-a", "Open A", "tree-a", { status: "open" }),
    card("tree-b", "Tree B"),
    card("open-b", "Open B", "tree-b", { status: "open" }),
    card("auth-flow", "Auth flow", "tree-a"),
    reopen("auth-flow", "rejected"),
  ]);
  const out = (await ok(p, ["find"])).out;
  const ids = out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(ids).toContain("open-a");
  expect(ids).toContain("open-b");
  expect(ids).toContain("auth-flow");
  expect(out).not.toContain("decided");
  for (const id of ["tree-a", "tree-b"]) expect(ids).not.toContain(id);
});

// ---------- 66 ----------

const storage = (): Ev[] => [
  card("root", "Root"),
  card("storage", "Storage", "root"),
  card("cache", "Cache", "storage", { status: "open" }),
  card("index", "Index", "storage", { status: "open" }),
  card("eviction", "Eviction", "cache", { status: "open" }),
];

test("66.1 an agent removes a bad branch and the log keeps its history", async () => {
  const p = withMap(storage());
  const before = lines(p);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  for (const id of ["cache", "eviction"]) {
    const s = await shown(p, id);
    expect(s.code).not.toBe(0);
    expect(s.all).toContain("removed");
  }
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).not.toContain("cache");
  expect(st).not.toContain("eviction");
  expect(st).toContain("index");
  expect((await ok(p, ["removed"])).out).toContain("cache");
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
});

test("66.2 a restore brings back the subtree with its links", async () => {
  const p = withMap([
    ...storage(),
    card("memory-budget", "Memory budget", "root"),
    link("cache", "memory-budget", "depends_on", "fits the budget"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const s = await shown(p, "cache");
  expect(s.code).toBe(0);
  expect(s.all).not.toContain("removed");
  expect(s.out).toContain("parent: storage");
  expect((await ok(p, ["show", "storage"])).out).toContain("cache");
  expect((await ok(p, ["show", "eviction"])).out).toContain("parent: cache");
  expect(s.out).toMatch(/depends_on\s+memory-budget/);
  expect((await ok(p, ["removed"])).out).not.toContain("cache");
}, 30_000);

test("66.3 remove with lift keeps the good children", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("bad-layer", "Bad layer", "storage"),
    card("write-path", "Write path", "bad-layer"),
    card("read-path", "Read path", "bad-layer"),
  ]);
  await ok(p, ["remove", "bad-layer", "--actor", "you", "--reparent"]);
  const bad = await shown(p, "bad-layer");
  expect(bad.code).not.toBe(0);
  expect(bad.all).toContain("removed");
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).toContain("write-path");
  expect(st).toContain("read-path");
  for (const id of ["write-path", "read-path"]) {
    const s = await shown(p, id);
    expect(s.code).toBe(0);
    expect(s.out).toContain("parent: storage");
    expect(s.all).not.toContain("removed");
  }
});

test("66.4 find skips paused, stale and outside cards", async () => {
  const p = withMap([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("cache", "Cache", "storage", { status: "open" }),
    card("index", "Index", "storage", { status: "open" }),
    card("backup", "Backup", "storage", { status: "open" }),
    card("quota", "Quota", "storage", { status: "open" }),
    card("elsewhere", "Elsewhere", "root", { status: "open" }),
    card("plan-p", "Postponed plan", "root"),
    card("plan-r", "Rejected plan", "root"),
    link("backup", "plan-p", "depends_on", "needs it"),
    link("quota", "plan-r", "depends_on", "needs it"),
    reopen("plan-p", "postponed"),
    reopen("plan-r", "rejected"),
  ]);
  const out = (await ok(p, ["find", "storage"])).out;
  const ids = out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(ids).toContain("cache");
  expect(ids).toContain("index");
  for (const id of ["backup", "quota", "elsewhere"]) expect(ids).not.toContain(id);
});

test("66.5 a removed branch drops out of find and comes back after a restore", async () => {
  const p = withMap(storage());
  await ok(p, ["remove", "cache", "--actor", "you"]);
  let ids = (await ok(p, ["find", "storage"])).out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(ids).toContain("index");
  expect(ids).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  ids = (await ok(p, ["find", "storage"])).out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("  ")[0]);
  expect(ids).toContain("index");
  expect(ids).toContain("cache");
}, 30_000);
