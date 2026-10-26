// Held-out steps 08.x, 66.x, 09.x at the command-line seam.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../../src/map/store.ts";
import { shapeRead } from "../../src/serve/map-api.ts";
import { freshProject, type Project } from "../../src/test/project.ts";

type Payload = Record<string, unknown>;
type Ev = [string, Payload];
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
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}
const shape = (p: Project) => shapeRead(readMap("test", logOf(p)));
const shapeIds = (p: Project) => shape(p).nodes.map((n) => n.id);
const hasEdge = (p: Project, from: string, to: string, type: string) =>
  shape(p).edges.some((e) => e.from === from && e.to === to && e.type === type);
const parentIn = (p: Project, id: string) => shape(p).edges.find((e) => e.from === id && e.type === "refines")?.to;

test("08.1", async () => {
  const p = withMap([
    card("root", "Root"),
    card("auth", "Auth", "root", { status: "decided" }),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    link("login", "audit", "depends_on", "Login writes the audit"),
  ]);
  const count = lines(p).length;
  await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) {
    expect((await p.werk(["show", id])).code).toBe(1);
    expect(shapeIds(p)).not.toContain(id);
  }
  expect((await ok(p, ["show", "root"])).out).not.toMatch(/auth|login|session/);
  expect((await ok(p, ["find"])).out).not.toMatch(/auth|login|session/);
  expect((await ok(p, ["search"])).out).not.toMatch(/auth|login|session/);
  expect(lines(p)).toHaveLength(count + 1);
  expect(JSON.parse(lines(p).at(-1) as string)).toMatchObject({ type: "node.removed", payload: { id: "auth" } });
  const removed = (await ok(p, ["removed"])).out;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  expect(hasEdge(p, "login", "audit", "depends_on")).toBe(false);
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toMatch(
    /<- refines\s+login[\s\S]*<- refines\s+session|<- refines\s+session[\s\S]*<- refines\s+login/,
  );
  expect(parentIn(p, "login")).toBe("auth");
  expect(parentIn(p, "session")).toBe("auth");
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+audit/);
  expect(hasEdge(p, "login", "audit", "depends_on")).toBe(true);
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, 60_000);

test("08.2", async () => {
  const p = withMap([
    card("platform", "Platform"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await p.werk(["show", "auth"])).code).toBe(1);
  expect(shapeIds(p)).not.toContain("auth");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  expect(parentIn(p, "login")).toBe("platform");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const plat = (await ok(p, ["show", "platform"])).out;
  expect(plat).not.toMatch(/refines\s+login/);
  expect(plat).not.toMatch(/refines\s+session/);
}, 60_000);

test("08.3", async () => {
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
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(shapeIds(p)).toContain("login");
  expect((await ok(p, ["show", "login"])).out).not.toContain("session");
  expect(hasEdge(p, "login", "session", "depends_on")).toBe(false);
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toMatch(/-> depends_on\s+session/);
  expect(hasEdge(p, "login", "session", "depends_on")).toBe(true);
}, 60_000);

test("08.4", async () => {
  const p = withMap([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    ["node.added", { id: "rfc-6749", kind: "source", title: "OAuth 2.0" }],
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const src = await ok(p, ["show", "rfc-6749"]);
  expect(src.out).toMatch(/<- supported_by\s+billing/);
  expect(shapeIds(p)).toContain("rfc-6749");
  const count = lines(p).length;
  const add = await p.werk(["add", "login", "--title", "Login is by password", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(lines(p)).toHaveLength(count);
  expect(shapeIds(p)).not.toContain("login");
}, 60_000);

test("08.5", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  const before = lines(p);
  const r = await p.werk(["remove", "login"]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(0);
  expect(shapeIds(p)).toContain("login");
  expect(lines(p)).toEqual(before);
});

test("08.6", async () => {
  const p = withMap([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = lines(p);
  const r = await p.werk(["restore", "login"]);
  expect(r.code).not.toBe(0);
  expect((await p.werk(["show", "login"])).code).toBe(1);
  expect(shapeIds(p)).not.toContain("login");
  expect(lines(p)).toEqual(before);
});

// The 66.x steps say "the agent removes"; remove only runs with --actor you, so these pass it.
test("66.1", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
    card("eviction", "Eviction", "cache"),
  ]);
  const before = lines(p);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const c = await p.werk(["show", "cache"]);
  expect(c.out + c.err).toContain("removed");
  const e = await p.werk(["show", "eviction"]);
  expect(e.out + e.err).toContain("removed");
  const s = (await ok(p, ["show", "storage"])).out;
  expect(s).not.toMatch(/cache|eviction/i);
  expect(s).toMatch(/<- refines\s+index/);
  expect(shapeIds(p)).not.toContain("cache");
  expect(shapeIds(p)).not.toContain("eviction");
  expect(parentIn(p, "index")).toBe("storage");
  expect((await ok(p, ["removed"])).out).toContain("cache");
  const after = lines(p);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
}, 30_000);

test("66.2", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("cache", "Cache", "storage"),
    card("eviction", "Eviction", "cache"),
    card("budget", "Memory budget"),
    link("cache", "budget", "depends_on", "The cache fits the budget"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await ok(p, ["show", "cache"]);
  expect(c.out + c.err).not.toContain("removed");
  expect(c.out).toContain("parent: storage");
  expect((await ok(p, ["show", "eviction"])).out).toContain("parent: cache");
  expect(c.out).toMatch(/-> depends_on\s+budget\s+Memory budget/);
  expect((await ok(p, ["removed"])).out).not.toContain("cache");
}, 30_000);

test("66.3", async () => {
  const p = withMap([
    card("storage", "Storage"),
    card("bad", "Bad layer", "storage"),
    card("write", "Write path", "bad"),
    card("read", "Read path", "bad"),
  ]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  const b = await p.werk(["show", "bad"]);
  expect(b.out + b.err).toContain("removed");
  expect(parentIn(p, "write")).toBe("storage");
  expect(parentIn(p, "read")).toBe("storage");
  const w = await ok(p, ["show", "write"]);
  expect(w.out).toContain("parent: storage");
  expect(w.out + w.err).not.toContain("removed");
  const r = await ok(p, ["show", "read"]);
  expect(r.out + r.err).not.toContain("removed");
}, 30_000);

test("66.4", async () => {
  const p = withMap([
    card("storage", "Storage", undefined, { status: "decided" }),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
    card("backup", "Backup", "storage"),
    card("quota", "Quota", "storage"),
    card("other", "Other tree", undefined, { status: "decided" }),
    card("vendor", "Vendor choice", "other", { status: "decided" }),
    card("limits", "Limits", "other", { status: "decided" }),
    card("outside", "Outside work", "other"),
    link("backup", "vendor", "depends_on", "Backup goes to the vendor"),
    link("quota", "limits", "depends_on", "Quota follows the limits"),
    ["node.reopened", { id: "vendor", reason: "postponed" }],
    ["node.reopened", { id: "limits", reason: "rejected" }],
  ]);
  const stale = (await ok(p, ["stale"])).out;
  expect(stale).toContain("backup");
  expect(stale).toContain("quota");
  const out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("cache  open  Cache");
  expect(out).toContain("index  open  Index");
  expect(out).not.toContain("backup");
  expect(out).not.toContain("quota");
  expect(out).not.toContain("outside");
});

test("66.5", async () => {
  const p = withMap([
    card("storage", "Storage", undefined, { status: "decided" }),
    card("cache", "Cache", "storage"),
    card("index", "Index", "storage"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  let out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("index");
  expect(out).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  out = (await ok(p, ["find", "storage"])).out;
  expect(out).toContain("cache  open  Cache");
  expect(out).toContain("index  open  Index");
});

test("09.1", async () => {
  const p = withMap([
    card("root", "Root", undefined, { status: "decided" }),
    card("d1", "First decided", "root", { status: "decided" }),
    card("d2", "Second decided", "root", { status: "decided" }),
    card("open1", "An open card", "root"),
    ["node.proposed", { id: "ghost", kind: "card", title: "A ghost card", parent: "root", status: "decided" }],
  ]);
  const out = (await ok(p, ["search"])).out;
  expect(out).toBe("root  Root\nd1  First decided\nd2  Second decided\n");
  expect(out).not.toContain("open1");
  expect(out).not.toContain("ghost");
});

test("09.2", async () => {
  const p = withMap([
    card("root", "Root"),
    card("cache-layout", "Cache layout", "root", {
      status: "decided",
      body: "Cache eviction runs every hour. The eviction policy is least recently used.",
    }),
    card("eviction-timer", "Eviction timer", "root", {
      why: "The eviction must run on time.",
      body: "CACHE warmup comes first.",
    }),
    card("cache-size", "Cache size", "root", { status: "decided", body: "The cache holds one gigabyte." }),
    card("gone", "Gone card", "root", { body: "The cache eviction of the old system." }),
  ]);
  await ok(p, ["remove", "gone", "--actor", "you"]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  expect(out).toBe("cache-layout  decided  Cache layout\neviction-timer  open  Eviction timer\n");
}, 30_000);

test("09.3", async () => {
  const p = withMap([
    card("parent", "Parent topic", undefined, { status: "decided" }),
    card("storage-format", "Storage format", "parent", { status: "decided", body: "The map is a JSON lines file." }),
    [
      "node.added",
      { id: "storage-format:opt0", kind: "option", title: "A database file", why_not: "SQLite needs a native build" },
    ],
    link("storage-format:opt0", "storage-format", "alternative_to"),
    card("other", "Other root"),
    card("outside", "Local cache", "other", { body: "Keep a sqlite file next to the log." }),
  ]);
  let out = (await ok(p, ["search", "sqlite"])).out;
  expect(out).toContain("storage-format  decided  Storage format");
  expect(out).toContain("outside  open  Local cache");
  out = (await ok(p, ["search", "sqlite", "--under", "parent"])).out;
  expect(out).toBe("storage-format  decided  Storage format\n");
  out = (await ok(p, ["search", "sqlite", "--status", "decided"])).out;
  expect(out).toBe("storage-format  decided  Storage format\n");
});

test("09.4", async () => {
  const p = withMap([
    card("client", "Client", undefined, { status: "decided" }),
    card("routing", "Routing", "client"),
    card("theme", "Theme", "client", { status: "proto" }),
    card("guards", "Route guards", "routing"),
    card("paused-card", "Paused card", "client"),
    card("stale-card", "Stale card", "client"),
    card("postponed-card", "Postponed card", "client", { status: "decided" }),
    card("basis", "Basis tree"),
    card("basis-p", "Basis postponed", "basis", { status: "decided" }),
    card("basis-s", "Basis invalidated", "basis", { status: "decided" }),
    link("paused-card", "basis-p", "depends_on", "Needs it"),
    link("stale-card", "basis-s", "depends_on", "Needs it"),
    ["node.reopened", { id: "basis-p", reason: "postponed" }],
    ["node.reopened", { id: "basis-s", reason: "invalidated" }],
    ["node.reopened", { id: "postponed-card", reason: "postponed" }],
    ["node.added", { id: "routing:opt0", kind: "option", title: "Hash routes", why_not: "Ugly" }],
    link("routing:opt0", "routing", "alternative_to"),
    ["node.added", { id: "router-doc", kind: "source", title: "Router docs" }],
    link("routing", "router-doc", "supported_by"),
    card("billing-root", "Money"),
    card("billing", "Billing", "billing-root"),
  ]);
  let out = (await ok(p, ["find", "routing"])).out;
  expect(out).toBe("routing  open  Routing\nguards  open  Route guards\n");
  expect(out).not.toMatch(/billing|opt0|router-doc/);
  out = (await ok(p, ["find", "client"])).out;
  const ls = out
    .trim()
    .split("\n")
    .map((l) => l.split("  ")[0]);
  expect(ls).toContain("routing");
  expect(ls).toContain("theme");
  expect(ls).toContain("guards");
  expect(ls.indexOf("routing")).toBeLessThan(ls.indexOf("guards"));
  expect(ls.indexOf("theme")).toBeLessThan(ls.indexOf("guards"));
  expect(ls).not.toContain("client");
  expect(ls).not.toContain("paused-card");
  expect(ls).not.toContain("stale-card");
  expect(ls).not.toContain("postponed-card");
});

test("09.5", async () => {
  const p = withMap([
    card("tree-a", "Tree A", undefined, { status: "decided" }),
    card("work-a", "Work A", "tree-a"),
    card("auth-flow", "Auth flow", "tree-a", { status: "decided" }),
    card("tree-b", "Tree B", undefined, { status: "decided" }),
    card("work-b", "Work B", "tree-b"),
    ["node.reopened", { id: "auth-flow", reason: "rejected" }],
  ]);
  const out = (await ok(p, ["find"])).out;
  expect(out).toContain("work-a  open  Work A");
  expect(out).toContain("work-b  open  Work B");
  expect(out).toContain("auth-flow  open  Auth flow");
  expect(out).not.toContain("decided");
  expect(out).not.toMatch(/tree-a|tree-b/);
});
