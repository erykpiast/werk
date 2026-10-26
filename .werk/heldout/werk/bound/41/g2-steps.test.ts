import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Ev = { type: string; payload: Record<string, unknown>; actor?: string };
const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const logLines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
const day = new Date().toISOString().slice(0, 10);

function seeded(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map((e, i) =>
    JSON.stringify({ seq: i + 1, at: `${day}T09:00:00Z`, actor: e.actor ?? "you", type: e.type, payload: e.payload }),
  );
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}
const card = (id: string, title: string, parent?: string, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title, status: "decided", who: "me", ...(parent ? { parent } : {}), ...extra },
});
const open = (id: string, title: string, parent?: string, extra: Record<string, unknown> = {}) =>
  card(id, title, parent, { status: "open", ...extra });
const node = (id: string, kind: string, title: string, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind, title, ...extra },
});
const link = (from: string, to: string, type: string, why?: string): Ev => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});
const dep = (from: string, to: string): Ev => link(from, to, "depends_on", `${from} uses ${to}`);
const kill = (id: string): Ev => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
const reopened = (id: string, reason: string, why?: string): Ev => ({
  type: "node.reopened",
  payload: { id, reason, ...(why ? { why } : {}) },
});
const removedEv = (id: string): Ev => ({ type: "node.removed", payload: { id } });

async function w(p: Project, args: string[]) {
  return p.werk(args);
}
async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}
const T = 60_000;

test("08.1", async () => {
  const p = seeded([
    card("root", "Root"),
    card("auth", "Auth", "root"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
    card("audit", "Audit", "root"),
    dep("login", "audit"),
  ]);
  const n = logLines(p).length;
  const rm = await ok(p, ["remove", "auth", "--actor", "you"]);
  for (const id of ["auth", "login", "session"]) expect((await w(p, ["show", id])).code).toBe(1);
  const rootShow = (await ok(p, ["show", "root"])).out;
  for (const id of ["auth", "login", "session"]) expect(rootShow).not.toContain(id);
  expect((await ok(p, ["show", "audit"])).out).not.toContain("login");
  expect(logLines(p).length).toBe(n + 1);
  expect(JSON.parse(logLines(p).at(-1) as string).type).toBe("node.removed");
  const listed = (await ok(p, ["removed"])).out;
  expect(listed).toContain("auth: removed");
  expect(listed).toContain("and login");
  expect(listed).toContain("and session");
  expect(rm.out).toContain("login");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  const lg = (await ok(p, ["show", "login"])).out;
  expect(lg).toContain("parent: auth");
  expect(lg).toContain("depends_on      audit");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "audit"])).out).toContain("login");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, T);

test("08.2", async () => {
  const p = seeded([
    card("root", "Root"),
    card("platform", "Platform", "root"),
    card("auth", "Auth", "platform"),
    card("login", "Login", "auth"),
    card("session", "Session", "auth"),
  ]);
  await ok(p, ["remove", "auth", "--actor", "you", "--reparent"]);
  expect((await w(p, ["show", "auth"])).code).toBe(1);
  expect((await ok(p, ["show", "login"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: platform");
  const plat = (await ok(p, ["show", "platform"])).out;
  expect(plat).toContain("login");
  expect(plat).toContain("session");
  await ok(p, ["restore", "auth", "--actor", "you"]);
  expect((await ok(p, ["show", "auth"])).out).toContain("parent: platform");
  expect((await ok(p, ["show", "login"])).out).toContain("parent: auth");
  expect((await ok(p, ["show", "session"])).out).toContain("parent: auth");
  const plat2 = (await ok(p, ["show", "platform"])).out;
  expect(plat2).not.toMatch(/\blogin\b/);
  expect(plat2).not.toMatch(/\bsession\b/);
}, T);

test("08.3", async () => {
  const p = seeded([
    card("root", "Root"),
    card("b1", "Branch 1", "root"),
    card("b2", "Branch 2", "root"),
    card("login", "Login", "b1"),
    card("session", "Session", "b2"),
    dep("login", "session"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  await ok(p, ["remove", "session", "--actor", "you"]);
  await ok(p, ["restore", "login", "--actor", "you"]);
  const l = (await ok(p, ["show", "login"])).out;
  expect(l).toContain("card login");
  expect(l).not.toContain("depends_on");
  await ok(p, ["restore", "session", "--actor", "you"]);
  expect((await ok(p, ["show", "login"])).out).toContain("-> depends_on      session");
  expect((await ok(p, ["show", "session"])).out).toContain("<- depends_on      login");
}, T);

test("08.4", async () => {
  const p = seeded([
    card("root", "Root"),
    card("login", "Login", "root"),
    card("billing", "Billing", "root"),
    node("rfc-6749", "source", "RFC 6749"),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  ]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const s = (await ok(p, ["show", "rfc-6749"])).out;
  expect(s).toContain("billing");
  expect(s).not.toContain("login");
  const n = logLines(p).length;
  const add = await w(p, ["add", "login", "--title", "New login", "--parent", "root"]);
  expect(add.code).not.toBe(0);
  expect(add.err).toContain("restore #login");
  expect(logLines(p).length).toBe(n);
  expect((await w(p, ["show", "login"])).out).not.toContain("New login");
  expect((await ok(p, ["show", "root"])).out).not.toContain("login");
}, T);

test("08.5", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", "root")]);
  const before = logLines(p);
  const r = await w(p, ["remove", "login"]);
  expect(r.code).toBe(1);
  expect((await ok(p, ["show", "login"])).out).toContain("card login");
  expect(logLines(p)).toEqual(before);
}, T);

test("08.6", async () => {
  const p = seeded([card("root", "Root"), card("login", "Login", "root")]);
  await ok(p, ["remove", "login", "--actor", "you"]);
  const before = logLines(p);
  const r = await w(p, ["restore", "login"]);
  expect(r.code).toBe(1);
  expect((await w(p, ["show", "login"])).code).toBe(1);
  expect(logLines(p)).toEqual(before);
}, T);

test("09.1", async () => {
  const p = seeded([
    card("root", "Root"),
    card("d1", "Decided one", "root"),
    card("d2", "Decided two", "root"),
    open("o1", "Open one", "root"),
    { type: "node.proposed", payload: { id: "g1", kind: "card", title: "Ghost one", status: "decided", parent: "root" } },
  ]);
  const out = (await ok(p, ["search"])).out;
  const lines = out.split("\n").filter(Boolean);
  expect(lines).toEqual(["root  Root", "d1  Decided one", "d2  Decided two"]);
  expect(out).not.toContain("Open one");
  expect(out).not.toContain("Ghost");
}, T);

test("09.2", async () => {
  const p = seeded([
    card("root", "Root"),
    card("cl", "Cache layout", "root", { body: "Cache eviction and the eviction policy" }),
    open("et", "Eviction timer", "root", { why: "eviction", body: "CACHE warmup" }),
    card("cs", "Cache size", "root", { body: "cache only" }),
    card("gone", "Gone", "root", { body: "cache eviction" }),
    removedEv("gone"),
  ]);
  const out = (await ok(p, ["search", "cache", "eviction"])).out;
  expect(out.split("\n").filter(Boolean)).toEqual(["cl  decided  Cache layout", "et  open  Eviction timer"]);
}, T);

test("09.3", async () => {
  const p = seeded([
    card("root", "Root"),
    card("parent", "Parent topic", "root"),
    card("storage", "Storage format", "parent"),
    node("storage:opt0", "option", "Opt", { why_not: "SQLite needs a native build" }),
    link("storage:opt0", "storage", "alternative_to"),
    open("elsewhere", "Elsewhere", "root", { body: "we may use sqlite" }),
  ]);
  const all = (await ok(p, ["search", "sqlite"])).out.split("\n").filter(Boolean);
  expect(all).toContain("storage  decided  Storage format");
  expect(all).toContain("elsewhere  open  Elsewhere");
  expect(all).toHaveLength(2);
  expect((await ok(p, ["search", "sqlite", "--under", "parent"])).out).toBe("storage  decided  Storage format\n");
  expect((await ok(p, ["search", "sqlite", "--status", "decided"])).out).toBe("storage  decided  Storage format\n");
}, T);

test("09.4", async () => {
  const p = seeded([
    card("top", "Top"),
    card("client", "Client", "top"),
    open("routing", "Routing", "client"),
    open("theme", "Theme", "client", { status: "proto" }),
    open("guards", "Route guards", "routing"),
    // upstream cards for paused and stale
    card("up-p", "Upstream postponed", "top"),
    card("up-r", "Upstream rejected", "top"),
    open("paused", "Paused card", "client"),
    open("stale", "Stale card", "client"),
    card("postponed", "Postponed card", "client"),
    dep("paused", "up-p"),
    dep("stale", "up-r"),
    node("routing:opt0", "option", "Routing option", { why_not: "no" }),
    link("routing:opt0", "routing", "alternative_to"),
    node("src", "source", "A source"),
    link("routing", "src", "supported_by"),
    open("billing", "Billing", "top"),
    kill("up-p"),
    reopened("up-p", "postponed"),
    reopened("up-r", "rejected"),
    reopened("postponed", "postponed"),
  ]);
  // sanity of marks
  const marks = (await ok(p, ["stale"])).out;
  const r1 = (await ok(p, ["find", "routing"])).out.split("\n").filter(Boolean);
  expect(r1).toEqual(["routing  open  Routing", "guards  open  Route guards"]);
  const r2 = (await ok(p, ["find", "client"])).out;
  const ids = r2.split("\n").filter(Boolean).map((l) => l.split("  ")[0]);
  expect(ids).toEqual(["routing", "theme", "guards"]);
  expect(r2).not.toContain("Client");
  for (const bad of ["paused", "stale", "postponed", "billing"]) expect(ids).not.toContain(bad);
  expect(marks).toContain("paused   paused");
  expect(marks).toContain("stale    stale");
}, T);

test("09.5", async () => {
  const p = seeded([
    open("t1", "Tree one", undefined),
    open("t2", "Tree two", undefined),
    card("auth", "Auth flow", "t1"),
    reopened("auth", "rejected"),
  ]);
  const out = (await ok(p, ["find"])).out;
  const ids = out.split("\n").filter(Boolean).map((l) => l.split("  ")[0]);
  expect(ids.sort()).toEqual(["auth", "t1", "t2"]);
  expect(out).not.toContain("decided");
}, T);

const chain = (extra: Ev[] = []) => [
  card("root", "Root"),
  card("a", "Card a", "root"),
  card("b", "Card b", "root"),
  card("c", "Card c", "root"),
  kill("a"),
  kill("b"),
  ...extra,
];

test("65.1", async () => {
  const p = seeded([...chain([dep("b", "a"), dep("c", "b")])]);
  await ok(p, ["reopen", "a", "--reason", "rejected", "--why", "the storage choice is wrong"]);
  const st = (await ok(p, ["stale"])).out;
  expect(st).toContain("stale    b  Card b");
  expect(st).toContain(`from #a, rejected, ${day}`);
  expect(st).not.toContain("Card c");
  const b = (await ok(p, ["show", "b"])).out;
  expect(b).toContain("b -> a depends_on");
  const c = (await ok(p, ["show", "c"])).out;
  expect(c.split("\n")[0]).not.toMatch(/stale|paused/);
  expect(c).not.toContain("Why this card is");
}, T);

test("65.2", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "Card a", "root"),
    card("b", "Card b", "root"),
    card("c", "Card c", "root"),
    card("d", "Card d", "root"),
    kill("a"),
    dep("b", "a"),
    dep("c", "b"),
    dep("d", "c"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed", "--why", "the engine build waits for next quarter"]);
  for (const id of ["b", "c", "d"]) expect((await ok(p, ["show", id])).out).toContain("Why this card is paused");
  const d = (await ok(p, ["show", "d"])).out;
  expect(d).toStartWith("card d  [decided]");
  const st = (await ok(p, ["stale"])).out;
  expect(st).toContain("paused   d  Card d");
  expect(st).toContain(`from #a, postponed, ${day}`);
  expect(st).not.toContain("stale    ");
  for (const id of ["b", "c", "d"]) expect((await ok(p, ["show", id])).out).not.toContain("Why this card is stale");
}, T);

test("65.3", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "Card a", "root"),
    card("b", "Card b", "root"),
    card("c", "Card c", "b"),
    kill("a"),
    kill("b"),
    dep("c", "a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  await ok(p, ["reopen", "b", "--reason", "rejected"]);
  const c = (await ok(p, ["show", "c"])).out;
  expect(c.split("\n")[0]).toContain("stale");
  expect(c.split("\n")[0]).not.toContain("paused");
  const st = (await ok(p, ["stale"])).out;
  expect(st).toContain("stale    c  Card c");
  expect(st).toContain(`from #b, rejected, ${day}`);
  expect(st).not.toContain("paused   c");
}, T);

test("65.4", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "Card a", "root"),
    card("b", "Card b", "root"),
    card("c", "Card c", "root"),
    kill("a"),
    dep("b", "a"),
    dep("c", "a"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "rejected"]);
  const before = (await ok(p, ["stale"])).out;
  expect(before).toContain("stale    b");
  expect(before).toContain("stale    c");
  const r = await w(p, ["rederive", "b", "--confirm", "a"]);
  if (r.code !== 0) throw new Error(`rederive b refused: code ${r.code} err=${r.err} out=${r.out}`);
  const st = (await ok(p, ["stale"])).out;
  expect(st).not.toContain("Card b");
  expect(st).toContain("stale    c  Card c");
  expect(st).toContain(`from #a, rejected, ${day}`);
  expect((await ok(p, ["show", "b"])).out.split("\n")[0]).not.toContain("stale");
}, T);

test("65.5", async () => {
  const p = seeded([
    card("root", "Root"),
    card("a", "Card a", "root"),
    card("b", "Card b", "root"),
    card("c", "Card c", "root"),
    kill("a"),
    dep("b", "a"),
    dep("c", "b"),
  ]);
  await ok(p, ["reopen", "a", "--reason", "postponed"]);
  for (const id of ["b", "c"]) expect((await ok(p, ["show", id])).out).toContain("paused");
  await ok(p, ["status", "a", "decided"]);
  for (const id of ["b", "c"]) expect((await ok(p, ["show", id])).out).not.toContain("paused");
  const st = (await ok(p, ["stale"])).out;
  expect(st).not.toContain("Card b");
  expect(st).not.toContain("Card c");
  expect((await ok(p, ["show", "c"])).out).toStartWith("card c  [decided]");
}, T);

const storage = () => [
  card("root", "Root"),
  card("storage", "Storage", "root"),
  card("cache", "Cache", "storage"),
  card("index", "Index", "storage"),
  card("eviction", "Eviction", "cache"),
];

test("66.1", async () => {
  const p = seeded(storage());
  const n = logLines(p).length;
  await ok(p, ["remove", "cache", "--actor", "you"]);
  for (const id of ["cache", "eviction"]) {
    const s = await w(p, ["show", id]);
    expect(s.err + s.out).toContain("is removed");
  }
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).not.toMatch(/\bcache\b/);
  expect(st).not.toMatch(/\beviction\b/);
  expect(st).toMatch(/\bindex\b/);
  expect((await ok(p, ["removed"])).out).toContain("cache: removed");
  expect(logLines(p).length).toBe(n + 1);
}, T);

test("66.1 without --actor you", async () => {
  const p = seeded(storage());
  const r = await w(p, ["remove", "cache"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("pass --actor you");
}, T);

test("66.2", async () => {
  const p = seeded([...storage(), card("budget", "Memory budget", "root"), dep("cache", "budget")]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const c = await ok(p, ["show", "cache"]);
  expect(c.out).not.toContain("removed");
  expect(c.out).toContain("parent: storage");
  expect(c.out).toContain("-> depends_on      budget  Memory budget");
  expect((await ok(p, ["show", "storage"])).out).toMatch(/\bcache\b/);
  expect((await ok(p, ["show", "eviction"])).out).toContain("parent: cache");
  expect((await ok(p, ["removed"])).out).toBe("no card is removed\n");
}, T);

test("66.3", async () => {
  const p = seeded([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    card("bad", "Bad layer", "storage"),
    card("write", "Write path", "bad"),
    card("read", "Read path", "bad"),
  ]);
  await ok(p, ["remove", "bad", "--actor", "you", "--reparent"]);
  expect(((await w(p, ["show", "bad"])).err)).toContain("is removed");
  const st = (await ok(p, ["show", "storage"])).out;
  expect(st).toMatch(/\bwrite\b/);
  expect(st).toMatch(/\bread\b/);
  for (const id of ["write", "read"]) {
    const s = await ok(p, ["show", id]);
    expect(s.out).toContain("parent: storage");
    expect(s.out).not.toContain("is removed");
  }
}, T);

test("66.4", async () => {
  const p = seeded([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    open("cache", "Cache", "storage"),
    open("index", "Index", "storage"),
    open("backup", "Backup", "storage"),
    open("quota", "Quota", "storage"),
    card("up-p", "Up p", "root"),
    card("up-r", "Up r", "root"),
    kill("up-p"),
    dep("backup", "up-p"),
    dep("quota", "up-r"),
    open("outside", "Outside", "root"),
    reopened("up-p", "postponed"),
    reopened("up-r", "rejected"),
  ]);
  const ids = (await ok(p, ["find", "storage"])).out.split("\n").filter(Boolean).map((l) => l.split("  ")[0]);
  expect(ids.sort()).toEqual(["cache", "index"]);
}, T);

test("66.5", async () => {
  const p = seeded([
    card("root", "Root"),
    card("storage", "Storage", "root"),
    open("cache", "Cache", "storage"),
    open("index", "Index", "storage"),
  ]);
  await ok(p, ["remove", "cache", "--actor", "you"]);
  const f1 = (await ok(p, ["find", "storage"])).out;
  expect(f1).toContain("index  open");
  expect(f1).not.toContain("cache");
  await ok(p, ["restore", "cache", "--actor", "you"]);
  const f2 = (await ok(p, ["find", "storage"])).out;
  expect(f2).toContain("index  open");
  expect(f2).toContain("cache  open");
}, T);
