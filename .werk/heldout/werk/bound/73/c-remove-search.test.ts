// Held-out steps 08.x, 66.x and 09.x: remove, restore, removed, search and find at the command line.
// "Shows in the map" is read through `werk show` of the card, of its parent and of the root, and
// through `werk find` / `werk search` where the step names them.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Payload = Record<string, unknown>;
type Ev = [type: string, payload: Payload];

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function withMap(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}
const card = (id: string, title: string, parent?: string, extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
const decided = (id: string, title: string, parent?: string, extra: Payload = {}): Ev =>
  card(id, title, parent, { status: "decided", who: "me", ...extra });
const open = (id: string, title: string, parent?: string, extra: Payload = {}): Ev =>
  card(id, title, parent, { status: "open", ...extra });
const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
const reopen = (id: string, reason: string): Ev => ["node.reopened", { id, reason }];

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const show = async (p: Project, id: string) => p.werk(["show", id]);
const ids = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split(/\s+/)[0]);

const T = 60_000;

// ---------- 08 ----------

test(
  "08.1",
  async () => {
    const p = withMap([
      decided("root", "Root"),
      decided("auth", "Auth", "root"),
      card("login", "Login", "auth"),
      card("session", "Session", "auth"),
      card("audit", "Audit", "root"),
      link("login", "audit", "depends_on", "Login writes the audit trail"),
    ]);
    const count = lines(p).length;
    const removed = await ok(p, ["remove", "auth", "--actor", "you"]);
    for (const id of ["auth", "login", "session"]) expect((await show(p, id)).code).not.toBe(0);
    const root = (await ok(p, ["show", "root"])).out;
    for (const id of ["auth", "login", "session"]) expect(root).not.toContain(id);
    expect((await ok(p, ["search"])).out).not.toContain("auth");
    expect(lines(p)).toHaveLength(count + 1);
    expect(JSON.parse(lines(p).at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
    const list = (await ok(p, ["removed"])).out;
    expect(list).toContain("auth");
    expect(list).toContain("login");
    expect(list).toContain("session");
    expect(removed.out).toBe(list);
    expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
    await ok(p, ["restore", "auth", "--actor", "you"]);
    const auth = (await ok(p, ["show", "auth"])).out;
    expect(auth).toContain("login");
    expect(auth).toContain("session");
    expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
    expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
    expect((await ok(p, ["show", "audit"])).out).toContain("login");
    expect((await ok(p, ["show", "login"])).out).toMatch(/depends_on\s+audit/);
    expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
  },
  T,
);

test(
  "08.2",
  async () => {
    const p = withMap([
      card("platform", "Platform"),
      card("auth", "Auth", "platform"),
      card("login", "Login", "auth"),
      card("session", "Session", "auth"),
    ]);
    await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
    expect((await show(p, "auth")).code).not.toBe(0);
    expect((await ok(p, ["show", "platform"])).out).not.toMatch(/\bauth\b/);
    expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
    expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
    await ok(p, ["restore", "auth", "--actor", "you"]);
    expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
    expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
    expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
    const platform = (await ok(p, ["show", "platform"])).out;
    expect(platform).not.toContain("login");
    expect(platform).not.toContain("session");
  },
  T,
);

test(
  "08.3",
  async () => {
    const p = withMap([
      card("root", "Root"),
      card("a", "Branch A", "root"),
      card("b", "Branch B", "root"),
      card("login", "Login", "a"),
      card("session", "Session", "b"),
      link("login", "session", "depends_on", "Login opens a session"),
    ]);
    await ok(p, ["remove", "login", "--actor", "you"]);
    await ok(p, ["remove", "session", "--actor", "you"]);
    await ok(p, ["restore", "login", "--actor", "you"]);
    const login = await show(p, "login");
    expect(login.code).toBe(0);
    expect(login.out).not.toContain("session");
    await ok(p, ["restore", "session", "--actor", "you"]);
    expect((await ok(p, ["show", "login"])).out).toMatch(/depends_on\s+session/);
  },
  T,
);

test(
  "08.4",
  async () => {
    const p = withMap([
      card("root", "Root"),
      card("login", "Login", "root"),
      card("billing", "Billing", "root"),
      ["node.added", { id: "rfc-6749", kind: "source", title: "RFC 6749" }],
      link("login", "rfc-6749", "supported_by"),
      link("billing", "rfc-6749", "supported_by"),
    ]);
    await ok(p, ["remove", "login", "--actor", "you"]);
    const src = (await ok(p, ["show", "rfc-6749"])).out;
    expect(src).toContain("billing");
    expect(src).not.toContain("login");
    const count = lines(p).length;
    const again = await p.werk(["add", "login", "--title", "New login", "--parent", "root"]);
    expect(again.code).not.toBe(0);
    expect(again.err).toContain("restore #login");
    expect(lines(p)).toHaveLength(count);
    expect((await show(p, "login")).code).not.toBe(0);
  },
  T,
);

test(
  "08.5",
  async () => {
    const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
    const before = lines(p);
    const run = await p.werk(["remove", "login"]);
    expect(run.code).not.toBe(0);
    expect((await show(p, "login")).code).toBe(0);
    expect(lines(p)).toEqual(before);
  },
  T,
);

test(
  "08.6",
  async () => {
    const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
    await ok(p, ["remove", "login", "--actor", "you"]);
    const before = lines(p);
    const run = await p.werk(["restore", "login"]);
    expect(run.code).not.toBe(0);
    expect((await show(p, "login")).code).not.toBe(0);
    expect(lines(p)).toEqual(before);
  },
  T,
);

// ---------- 66 ----------

test(
  "66.1",
  async () => {
    const p = withMap([
      card("storage", "Storage"),
      card("cache", "Cache", "storage"),
      card("index", "Index", "storage"),
      card("eviction", "Eviction", "cache"),
    ]);
    const before = lines(p);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    for (const id of ["cache", "eviction"]) {
      const run = await show(p, id);
      expect(run.code).not.toBe(0);
      expect(run.err).toContain("removed");
    }
    const storage = (await ok(p, ["show", "storage"])).out;
    expect(storage).not.toContain("cache");
    expect(storage).not.toContain("eviction");
    expect(storage).toContain("index");
    expect((await ok(p, ["removed"])).out).toContain("cache");
    const after = lines(p);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
  },
  T,
);

test(
  "66.2",
  async () => {
    const p = withMap([
      card("storage", "Storage"),
      card("budget", "Memory budget"),
      card("cache", "Cache", "storage"),
      card("eviction", "Eviction", "cache"),
      link("cache", "budget", "depends_on", "Cache size comes from the budget"),
    ]);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    await ok(p, ["restore", "cache", "--actor", "you"]);
    const cache = await show(p, "cache");
    expect(cache.code).toBe(0);
    expect(cache.out).not.toContain("removed");
    expect(cache.out).toContain("parent: storage");
    expect((await ok(p, ["show", "storage"])).out).toContain("cache");
    expect((await ok(p, ["show", "eviction"])).out).toContain("parent: cache");
    expect(cache.out).toMatch(/depends_on\s+budget/);
    expect((await ok(p, ["removed"])).out).not.toContain("cache");
  },
  T,
);

test(
  "66.3",
  async () => {
    const p = withMap([
      card("storage", "Storage"),
      card("bad", "Bad layer", "storage"),
      card("write", "Write path", "bad"),
      card("read", "Read path", "bad"),
    ]);
    await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
    const bad = await show(p, "bad");
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("removed");
    const storage = (await ok(p, ["show", "storage"])).out;
    expect(storage).toContain("write");
    expect(storage).toContain("read");
    for (const id of ["write", "read"]) {
      const run = await ok(p, ["show", id]);
      expect(run.out).toContain("parent: storage");
      expect(run.out + run.err).not.toContain("removed");
    }
  },
  T,
);

test(
  "66.4",
  async () => {
    const p = withMap([
      decided("base-p", "Postponed basis"),
      decided("base-r", "Rejected basis"),
      card("storage", "Storage"),
      open("cache", "Cache", "storage"),
      open("index", "Index", "storage"),
      open("backup", "Backup", "storage"),
      open("quota", "Quota", "storage"),
      open("outside", "Outside card"),
      link("backup", "base-p", "depends_on", "Backup waits on it"),
      link("quota", "base-r", "depends_on", "Quota rests on it"),
      reopen("base-p", "postponed"),
      reopen("base-r", "rejected"),
    ]);
    const out = ids((await ok(p, ["find", "storage"])).out);
    expect(out).toContain("cache");
    expect(out).toContain("index");
    expect(out).not.toContain("backup");
    expect(out).not.toContain("quota");
    expect(out).not.toContain("outside");
  },
  T,
);

test(
  "66.5",
  async () => {
    const p = withMap([
      card("storage", "Storage"),
      open("cache", "Cache", "storage"),
      open("index", "Index", "storage"),
    ]);
    await ok(p, ["remove", "cache", "--actor", "you"]);
    let out = ids((await ok(p, ["find", "storage"])).out);
    expect(out).toContain("index");
    expect(out).not.toContain("cache");
    await ok(p, ["restore", "cache", "--actor", "you"]);
    out = ids((await ok(p, ["find", "storage"])).out);
    expect(out).toContain("cache");
    expect(out).toContain("index");
  },
  T,
);

// ---------- 09 ----------

test(
  "09.1",
  async () => {
    const p = withMap([
      decided("d1", "First decided"),
      decided("d2", "Second decided", "d1"),
      decided("d3", "Third decided", "d1"),
      open("o1", "Open card", "d1"),
      ["node.proposed", { id: "g1", kind: "card", title: "Ghost card", parent: "d1", status: "decided", who: "me" }],
    ]);
    const out = (await ok(p, ["search"])).out;
    const rows = out.split("\n").filter((l) => l !== "");
    expect(rows).toHaveLength(3);
    expect(out).toContain("d1  First decided");
    expect(out).toContain("d2  Second decided");
    expect(out).toContain("d3  Third decided");
    expect(out).not.toContain("o1");
    expect(out).not.toContain("g1");
  },
  T,
);

test(
  "09.2",
  async () => {
    const p = withMap([
      decided("root", "Root"),
      decided("layout", "Cache layout", "root", { body: "Cache eviction runs hourly. The eviction policy is LRU." }),
      open("timer", "Eviction timer", "root", { why: "The eviction must be timed.", body: "CACHE warmup first." }),
      decided("size", "Cache size", "root", { body: "The cache holds 1 GB." }),
      decided("gone", "Old store", "root", { body: "cache eviction by hand" }),
    ]);
    await ok(p, ["remove", "gone", "--actor", "you"]);
    const out = (await ok(p, ["search", "cache", "eviction"])).out;
    const rows = out.split("\n").filter((l) => l !== "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe("layout  decided  Cache layout");
    expect(rows[1]).toBe("timer  open  Eviction timer");
    expect(out).not.toContain("Cache size");
    expect(out).not.toContain("gone");
  },
  T,
);

test(
  "09.3",
  async () => {
    const p = withMap([
      decided("root", "Root"),
      decided("parent", "Parent topic", "root"),
      decided("storage", "Storage format", "parent"),
      [
        "node.added",
        { id: "storage:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
      ],
      link("storage:opt0", "storage", "alternative_to"),
      open("other", "Other work", "root", { body: "Try sqlite later." }),
    ]);
    let rows = (await ok(p, ["search", "sqlite"])).out.split("\n").filter((l) => l !== "");
    expect(rows).toContain("storage  decided  Storage format");
    expect(rows).toContain("other  open  Other work");
    rows = (await ok(p, ["search", "sqlite", "--under", "parent"])).out.split("\n").filter((l) => l !== "");
    expect(rows).toEqual(["storage  decided  Storage format"]);
    rows = (await ok(p, ["search", "sqlite", "--status", "decided"])).out.split("\n").filter((l) => l !== "");
    expect(rows).toEqual(["storage  decided  Storage format"]);
  },
  T,
);

test(
  "09.4",
  async () => {
    const p = withMap([
      decided("base-p", "Postponed basis"),
      decided("base-r", "Rejected basis"),
      decided("client", "Client"),
      open("routing", "Routing", "client"),
      card("theme", "Theme", "client", { status: "proto" }),
      open("guards", "Route guards", "routing"),
      open("paused", "Paused card", "client"),
      open("staled", "Stale card", "client"),
      decided("later", "Postponed card", "client"),
      link("paused", "base-p", "depends_on", "Waits on it"),
      link("staled", "base-r", "depends_on", "Rests on it"),
      ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routing", why_not: "Ugly URLs" }],
      link("routing:opt0", "routing", "alternative_to"),
      ["node.added", { id: "rsrc", kind: "source", title: "Router docs" }],
      link("routing", "rsrc", "supported_by"),
      decided("billing-root", "Billing tree"),
      open("billing", "Billing", "billing-root"),
      reopen("base-p", "postponed"),
      reopen("base-r", "rejected"),
      reopen("later", "postponed"),
    ]);
    const r = ids((await ok(p, ["find", "routing"])).out);
    expect(r[0]).toBe("routing");
    expect(r.indexOf("guards")).toBeGreaterThan(0);
    for (const id of ["billing", "routing:opt0", "rsrc"]) expect(r).not.toContain(id);
    const c = ids((await ok(p, ["find", "client"])).out);
    expect(c.indexOf("routing")).toBeGreaterThanOrEqual(0);
    expect(c.indexOf("theme")).toBeGreaterThanOrEqual(0);
    expect(c.indexOf("routing")).toBeLessThan(c.indexOf("guards"));
    expect(c.indexOf("theme")).toBeLessThan(c.indexOf("guards"));
    for (const id of ["client", "paused", "staled", "later"]) expect(c).not.toContain(id);
  },
  T,
);

test(
  "09.5",
  async () => {
    const p = withMap([
      decided("t1", "Tree one"),
      open("o1", "Open in one", "t1"),
      decided("t2", "Tree two"),
      open("o2", "Open in two", "t2"),
      decided("auth", "Auth flow", "t2"),
      reopen("auth", "rejected"),
    ]);
    const out = ids((await ok(p, ["find"])).out);
    expect(out).toContain("o1");
    expect(out).toContain("o2");
    expect(out).toContain("auth");
    for (const id of ["t1", "t2"]) expect(out).not.toContain(id);
  },
  T,
);
