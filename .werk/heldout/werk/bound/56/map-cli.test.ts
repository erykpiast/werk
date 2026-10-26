import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, link, open } from "../src/map/mark-fixtures.ts";
import { cli, createProject, type Project, seedLog, SLOW, YOU } from "./support.ts";

let project: Project;
let werk: ReturnType<typeof cli>;
beforeEach(() => {
  project = createProject();
  werk = cli(project);
});
afterEach(() => project.dispose());

// ---------- 05 ----------

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  seedLog(project, decided("auth"));
  const before = project.events().length;
  const add = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(add.stdout.trim()).toBe("proposed");
  expect(project.events()).toHaveLength(before + 1);
  const shown = (await werk("show", "login")).stdout;
  expect(shown).toContain("Use magic links");
  expect(shown).toContain("proposed");
  expect(shown).toContain("auth");
  expect(shown).toMatch(/rollup:/);
}, SLOW);

test("05.2 a second add with the same id is refused and the log stays", async () => {
  await werk("add", "login", "--title", "First words");
  const before = project.events().length;
  const again = await werk("add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(project.events()).toHaveLength(before);
  expect((await werk("show", "login")).stdout).toContain("First words");
}, SLOW);

test("05.3 a decided status is refused on add", async () => {
  seedLog(project, decided("auth"));
  const before = project.events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(project.events()).toHaveLength(before);
  const shown = await werk("show", "pay");
  expect(shown.code).not.toBe(0);
  expect(shown.stderr).toMatch(/unknown card/);
}, SLOW);

test("05.4 a hash sign on an id is optional, a title keeps it", async () => {
  seedLog(project, open("auth"));
  const r = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toContain("auth");
}, SLOW);

test("05.5 a hand-written bad line is listed as a problem and later cards show", async () => {
  seedLog(
    project,
    open("auth"),
    { type: "node.proposed", id: "orphan", kind: "card", title: "x", status: "open", parent: "nowhere" },
    { type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open" },
  );
  const before = project.logPath;
  const r = await werk("show", "login");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stderr).toMatch(/problem at log line 3: unknown-card/);
  const raw = await Bun.file(before).text();
  expect(raw).toContain('"parent":"nowhere"');
}, SLOW);

// ---------- 06 ----------

const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
};
const spoken = (text: string) => ({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text });

test("06.1 + 06.2 a new excerpt stages as a ghost and the accept makes the link live", async () => {
  seedLog(project, decided("x"));
  chat("pricing", spoken("we bill per seat, always"));
  const q = await werk("quote", "x", "pricing", "bill per seat");
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const ex = (await werk("show", "x")).stdout;
  expect(ex).toContain("decided");
  const card = (await werk("show", "x")).stdout;
  expect(card).toContain("Title x");
  expect(card).toContain("bill per seat");
  expect(card).toContain("proposed"); // ghost marked on the Say line
  const exShown = (await werk("show", "x:ex0")).stdout;
  expect(exShown).toMatch(/proposed/);
  expect(exShown).not.toMatch(/Ev:|Options:/);
  const acc = await werk("accept", "x:ex0", ...YOU);
  expect(acc.code).toBe(0);
  const after = (await werk("show", "x:ex0")).stdout;
  expect(after).not.toMatch(/proposed/);
  expect(after).not.toMatch(/\[held\]/);
  const cardAfter = (await werk("show", "x")).stdout;
  expect(cardAfter).toContain("Say:");
  expect(cardAfter).toContain("bill per seat");
  expect(cardAfter).not.toMatch(/Say:\n.*proposed/);
}, SLOW);

// ---------- 08 ----------

const shows = async (id: string) => (await werk("show", id)).code === 0;

test("08.1 remove takes the subtree in one event and restore brings it and the link back", async () => {
  seedLog(
    project,
    decided("auth"),
    decided("login", { parent: "auth" }),
    decided("session", { parent: "auth" }),
    decided("audit"),
    link("login", "audit"),
  );
  const before = project.events().length;
  expect((await werk("remove", "auth", ...YOU)).code).toBe(0);
  expect(project.events()).toHaveLength(before + 1);
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  const login = (await werk("show", "login")).stdout;
  expect(login).toContain("auth");
  expect(login).toContain("audit");
  expect((await werk("show", "session")).stdout).toContain("auth");
  expect((await werk("removed")).stdout).not.toContain("auth");
}, SLOW);

test("08.2 remove --reparent moves the children up and restore puts them back", async () => {
  seedLog(
    project,
    decided("platform"),
    decided("auth", { parent: "platform" }),
    decided("login", { parent: "auth" }),
    decided("session", { parent: "auth" }),
  );
  expect((await werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
  expect(await shows("auth")).toBe(false);
  const platform = (await werk("show", "platform")).stdout;
  expect(platform).toContain("login");
  expect(platform).toContain("session");
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  const p2 = (await werk("show", "platform")).stdout;
  expect(p2).toContain("auth");
  expect(p2).not.toMatch(/<- refines\s+login/);
  expect(p2).not.toMatch(/<- refines\s+session/);
  const auth = (await werk("show", "auth")).stdout;
  expect(auth).toMatch(/<- refines\s+login/);
  expect(auth).toMatch(/<- refines\s+session/);
}, SLOW);

test("08.3 a link waits until both ends are back", async () => {
  seedLog(project, decided("root"), decided("login", { parent: "root" }), decided("session", { parent: "root" }), link("login", "session"));
  await werk("remove", "login", ...YOU);
  await werk("remove", "session", ...YOU);
  await werk("restore", "login", ...YOU);
  const login = (await werk("show", "login")).stdout;
  expect(login).not.toMatch(/depends_on/);
  await werk("restore", "session", ...YOU);
  expect((await werk("show", "login")).stdout).toMatch(/depends_on\s+session/);
}, SLOW);

test("08.4 a removed id stays taken and a cited source stays", async () => {
  seedLog(project, decided("root"), decided("login", { parent: "root" }), decided("billing", { parent: "root" }));
  await werk("add", "rfc-6749", "--title", "OAuth RFC", "--kind", "source");
  await werk("accept", "rfc-6749", ...YOU);
  const l = await werk("link", "login", "rfc-6749", "--type", "supported_by", "--why", "w");
  const l2 = await werk("link", "billing", "rfc-6749", "--type", "supported_by", "--why", "w");
  expect(l.code).toBe(0);
  expect(l2.code).toBe(0);
  await werk("remove", "login", ...YOU);
  const billing = (await werk("show", "billing")).stdout;
  expect(billing).toContain("rfc-6749");
  const add = await werk("add", "login", "--title", "New login");
  expect(add.code).not.toBe(0);
  expect(add.stderr).toMatch(/restore/);
  expect(add.stderr).toContain("login");
  expect((await werk("show", "login")).code).not.toBe(0);
}, SLOW);

test("08.5 remove without --actor you refuses", async () => {
  seedLog(project, decided("login"));
  const before = project.events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(project.events()).toHaveLength(before);
}, SLOW);

test("08.6 restore without --actor you refuses", async () => {
  seedLog(project, decided("login"));
  await werk("remove", "login", ...YOU);
  const before = project.events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(project.events()).toHaveLength(before);
}, SLOW);

// ---------- 09 ----------

test("09.1 search with no term lists the decided cards only", async () => {
  seedLog(
    project,
    decided("a"),
    decided("b"),
    decided("c"),
    open("o"),
    // a ghost that was decided before it became a ghost
    decided("g"),
    { type: "node.reopened", id: "g", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.proposed", id: "ghost1", kind: "card", title: "Ghost one", status: "open" },
  );
  const out = (await werk("search")).stdout;
  const lines = out.trim().split("\n");
  for (const id of ["a", "b", "c"]) expect(out).toMatch(new RegExp(`^${id}  Title ${id}$`, "m"));
  expect(out).not.toContain("Title o");
  expect(out).not.toContain("Ghost one");
  expect(lines.length).toBe(3);
}, SLOW);

test("09.2 two terms, best match first", async () => {
  seedLog(
    project,
    decided("cache-layout", { title: "Cache layout", body: "Cache eviction and the eviction policy" }),
    open("evict-timer", { title: "Eviction timer", why: "eviction", body: "CACHE warmup" }),
    decided("cache-size", { title: "Cache size" }),
    decided("gone", { title: "x", body: "cache eviction" }),
    { type: "node.removed", id: "gone", actor: "you" },
  );
  const out = (await werk("search", "cache", "eviction")).stdout.trim().split("\n");
  expect(out).toHaveLength(2);
  expect(out[0]).toContain("cache-layout");
  expect(out[0]).toContain("[decided]");
  expect(out[0]).toContain("Cache layout");
  expect(out[1]).toContain("evict-timer");
  expect(out[1]).toContain("[open]");
  const all = out.join("\n");
  expect(all).not.toContain("Cache size");
  expect(all).not.toContain("gone");
}, SLOW);

test("09.3 a word in a rejected option, narrowed by --under and --status", async () => {
  seedLog(
    project,
    decided("parent", { title: "Parent topic" }),
    decided("storage", { title: "Storage format", parent: "parent" }),
    ...open("opt", { kind: "option", title: "SQLite", why: "SQLite needs a native build" }),
    { type: "edge.added", from: "opt", to: "storage", link: "alternative_to", why: "alt" },
    open("elsewhere", { title: "Elsewhere", body: "we use sqlite there" }),
  );
  const all = (await werk("search", "sqlite")).stdout;
  expect(all).toContain("storage");
  expect(all).toContain("[decided]");
  expect(all).toContain("elsewhere");
  const under = (await werk("search", "sqlite", "--under", "parent")).stdout.trim().split("\n");
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("storage");
  const st = (await werk("search", "sqlite", "--status", "decided")).stdout.trim().split("\n");
  expect(st).toHaveLength(1);
  expect(st[0]).toContain("storage");
}, SLOW);

test("09.4 find lists the open work under one card", async () => {
  seedLog(
    project,
    decided("client", { title: "Client" }),
    open("routing", { title: "Routing", parent: "client" }),
    open("theme", { title: "Theme", parent: "client", status: "proto" }),
    open("guards", { title: "Route guards", parent: "routing" }),
    decided("da", { title: "Dep A" }),
    decided("db", { title: "Dep B", parent: "client" }),
    open("pausedkid", { title: "Paused card", parent: "client" }),
    open("stalekid", { title: "Stale card", parent: "client" }),
    link("pausedkid", "db"),
    link("stalekid", "da"),
    { type: "node.reopened", id: "da", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
    { type: "node.reopened", id: "db", reason: "postponed", at: "2026-10-10T09:00:00.000Z" },
    open("opt", { kind: "option", title: "An option" }),
    { type: "edge.added", from: "opt", to: "routing", link: "alternative_to", why: "a" },
    open("src", { kind: "source", title: "A source" }),
    { type: "edge.added", from: "routing", to: "src", link: "supported_by", why: "a" },
    open("billing", { title: "Billing" }),
  );
  const routing = (await werk("find", "routing")).stdout.trim().split("\n");
  expect(routing[0]).toContain("routing");
  expect(routing[1]).toContain("guards");
  const joined = routing.join("\n");
  expect(joined).not.toContain("billing");
  expect(joined).not.toContain("An option");
  expect(joined).not.toContain("A source");
  const client = (await werk("find", "client")).stdout;
  expect(client.indexOf("routing")).toBeLessThan(client.indexOf("guards"));
  expect(client.indexOf("theme")).toBeLessThan(client.indexOf("guards"));
  expect(client).not.toMatch(/^client /m);
  expect(client).not.toContain("Paused card");
  expect(client).not.toContain("Stale card");
  expect(client).not.toContain("Dep B");
}, SLOW);

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  seedLog(
    project,
    open("t1", { title: "Tree one" }),
    open("t2", { title: "Tree two" }),
    decided("auth", { title: "Auth flow" }),
    { type: "node.reopened", id: "auth", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const out = (await werk("find")).stdout;
  expect(out).toContain("t1");
  expect(out).toContain("t2");
  expect(out).toContain("Auth flow");
  expect(out).not.toContain("[decided]");
}, SLOW);

// ---------- 11 ----------

test("11.1 the rollup counts the card and its refines subtree", async () => {
  seedLog(
    project,
    decided("root"),
    decided("c1", { parent: "root" }),
    decided("g1", { parent: "c1" }),
    open("c2", { parent: "root", status: "proto" }),
    { type: "node.reopened", id: "c1", at: "2026-10-10T09:00:00.000Z" },
  );
  const out = (await werk("show", "root")).stdout;
  const lines = out.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("rollup: 4 cards: 1 open, 1 proto, 2 decided");
}, SLOW);

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seedLog(
    project,
    open("parent"),
    decided("child", { parent: "parent" }),
    open("g1", { parent: "child" }),
    decided("g2", { parent: "child" }),
    { type: "node.reopened", id: "child", at: "2026-10-10T09:00:00.000Z" },
  );
  const out = (await werk("show", "parent")).stdout;
  expect(out).toMatch(/<- refines\s+child .*\(rollup: 3 cards/);
  expect(out).toMatch(/^rollup: 4 cards/m);
}, SLOW);

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  seedLog(
    project,
    decided("dep"),
    decided("x"),
    link("x", "dep"),
    { type: "node.proposed", id: "opt", kind: "option", title: "Use Redis", status: "open", why: "too heavy" },
    { type: "node.accepted", id: "opt", actor: "you" },
    { type: "edge.added", from: "opt", to: "x", link: "alternative_to", why: "alt" },
    { type: "node.proposed", id: "src", kind: "source", title: "Benchmark", status: "open", why: "p99 was 4ms" },
    { type: "edge.added", from: "x", to: "src", link: "supported_by", why: "evidence" },
  );
  chat("pricing", spoken("we bill per seat, always"));
  await werk("quote", "x", "pricing", "bill per seat");
  const out = (await werk("show", "x")).stdout;
  expect(out).toMatch(/-> depends_on\s+dep/);
  expect(out).toContain("why: x takes dep");
  const links = out.indexOf("-> depends_on");
  expect(out.indexOf("Options:")).toBeGreaterThan(links);
  expect(out).toContain("Use Redis");
  expect(out).toContain("why not: too heavy");
  expect(out).toContain("Say:");
  expect(out).toContain("person: bill per seat");
  expect(out).toContain("Ev:");
  expect(out).toContain("Benchmark  proposed");
  expect(out).toContain("finding: p99 was 4ms");
}, SLOW);

test("11.4 a card with no options prints no Options section", async () => {
  seedLog(
    project,
    decided("x"),
    { type: "node.proposed", id: "src", kind: "source", title: "Benchmark", status: "open", why: "p99" },
    { type: "node.accepted", id: "src", actor: "you" },
    { type: "edge.added", from: "x", to: "src", link: "supported_by", why: "evidence" },
  );
  chat("pricing", spoken("we bill per seat, always"));
  await werk("quote", "x", "pricing", "bill per seat");
  const out = (await werk("show", "x")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options:");
}, SLOW);

test("11.5 show with no id prints the root card", async () => {
  seedLog(project, decided("top", { title: "The top" }), decided("second", { title: "Second", parent: "top" }));
  const out = (await werk("show")).stdout;
  expect(out).toContain("The top");
  expect(out).toMatch(/^rollup:/m);
  expect(out).toMatch(/<- refines\s+second .*rollup:/);
}, SLOW);
