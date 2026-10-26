import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { renderCardPage } from "../src/serve/card-page.ts";
import { cardRead, headerRead, shapeRead } from "../src/serve/read-api.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const YOU = ["--actor", "you"];
const SLOW = 90_000;

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

// ---- fixtures: hand-written log lines (setup only; the step's own action runs through the CLI)
type Ev = Record<string, unknown>;
const ghost = (id: string, extra: Ev = {}): Ev => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
const real = (id: string, extra: Ev = {}): Ev[] => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];
const decided = (id: string, extra: Ev = {}): Ev[] => [
  ...real(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
const link = (from: string, to: string, type: string, why = "w"): Ev => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why,
});
const AT = "2026-10-10T09:00:00.000Z";
const reopen = (id: string, reason: string): Ev => ({
  type: "node.reopened",
  id,
  reason,
  at: AT,
});
const setLog = (...events: (Ev | Ev[])[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
};
const lineCount = () =>
  readFileSync(project.logPath, "utf8")
    .split("\n")
    .filter((l) => l !== "").length;
const mapNow = () => readMap(project.logPath).map;
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");
const shows = async (id: string) => (await werk("show", id)).code === 0;
const parentOf = (id: string) =>
  shapeRead(mapNow()).edges.find((e) => e.from === id && e.type === "refines")
    ?.to;

// ---------------------------------------------------------------- 05
test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  setLog(decided("auth"));
  const before = lineCount();
  const added = await werk(
    "add",
    "login",
    "--title",
    "Use magic links",
    "--parent",
    "auth",
  );
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(lineCount()).toBe(before + 1);
  const shown = await werk("show", "login");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout.split("\n")[0]).toMatch(/\[open\]\s+proposed/);
  expect(shown.stdout).toMatch(/-> refines\s+auth\b/);
  expect(shown.stdout).toMatch(/^rollup: /m);
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  expect((await werk("add", "login", "--title", "First words")).code).toBe(0);
  const before = lineCount();
  const again = await werk("add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(lineCount()).toBe(before);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("First words");
  expect(shown.stdout).not.toContain("Other words");
});

test("05.3 a decided status is refused on add", async () => {
  setLog(decided("auth"));
  const before = lineCount();
  const r = await werk(
    "add",
    "pay",
    "--title",
    "Pay",
    "--parent",
    "auth",
    "--status",
    "decided",
  );
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not add|only through the status verb/);
  expect(lineCount()).toBe(before);
  const shown = await werk("show", "pay");
  expect(shown.code).not.toBe(0);
  expect(shown.stderr).toContain("unknown card");
});

test("05.4 a hash on an id is optional, a title keeps its hash", async () => {
  setLog(real("auth"));
  const added = await werk(
    "add",
    "#login",
    "--title",
    "#1 priority: magic links",
    "--parent",
    "#auth",
  );
  expect(added.stdout.trim()).toBe("proposed");
  const hashed = await werk("show", "#login");
  const plain = await werk("show", "login");
  expect(hashed.code).toBe(0);
  expect(hashed.stdout).toBe(plain.stdout);
  for (const out of [hashed.stdout, plain.stdout]) {
    expect(out).toMatch(/-> refines\s+auth\b/);
    expect(out).toContain("#1 priority: magic links");
  }
});

test("05.5 a hand-written bad line is a problem and later cards still show", async () => {
  const bad = {
    type: "node.proposed",
    id: "orphan",
    kind: "card",
    title: "Orphan",
    status: "open",
    parent: "nowhere",
  };
  setLog(real("auth"), bad, ghost("login"));
  const shown = await werk("show", "login");
  expect(shown.code).toBe(0);
  expect(shown.stdout.split("\n")[0]).toMatch(/\[open\]\s+proposed/);
  // the only verb that reports problems is show
  expect(shown.stderr).toMatch(/log line 3/);
  expect(shown.stderr).toContain("unknown-card");
  expect(readFileSync(project.logPath, "utf8")).toContain(JSON.stringify(bad));
});

// ---------------------------------------------------------------- 06
const spoken = (text: string) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
});
const chat = (name: string, ...rows: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    rows.map((r) => `${JSON.stringify(r)}\n`).join(""),
  );
};
const WORDS = "seats are the unit we bill";

test("06.1 a new excerpt stages as a ghost and waits for the check", async () => {
  setLog(decided("x", { title: "We charge per seat", body: "Body of x" }));
  chat("pricing", spoken(`yes: ${WORDS}`));
  const q = await werk("quote", "x", "pricing", WORDS);
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const map = mapNow();
  const ex = map.nodes.get("x:ex0");
  expect(ex?.proposed).toBe(true);
  const shape = shapeRead(map);
  expect(shape.nodes.find((n) => n.id === "x:ex0")?.proposed).toBe(true);
  expect(
    shape.edges.find(
      (e) => e.from === "x" && e.to === "x:ex0" && e.type === "supported_by",
    )?.held,
  ).toBe(true);
  const shown = (await werk("show", "x:ex0")).stdout;
  expect(shown.split("\n")[0]).toMatch(/\]\s+proposed/);
  const page = renderCardPage(map, map.nodes.get("x") as never);
  expect(page).toContain("tag-pending-link");
  // card keeps status and words
  const x = map.nodes.get("x");
  expect(x?.status).toBe("decided");
  expect(x?.title).toBe("We charge per seat");
  expect(x?.body).toBe("Body of x");
  expect(x?.proposed).toBe(false);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  setLog(decided("x", { title: "We charge per seat" }));
  chat("pricing", spoken(`yes: ${WORDS}`));
  await werk("quote", "x", "pricing", WORDS);
  expect(mapNow().nodes.get("x:ex0")?.proposed).toBe(true);
  const acc = await werk("accept", "x:ex0", ...YOU);
  expect(acc.code).toBe(0);
  const map = mapNow();
  expect(map.nodes.get("x:ex0")?.proposed).toBe(false);
  const shape = shapeRead(map);
  expect(
    shape.edges.find(
      (e) => e.from === "x" && e.to === "x:ex0" && e.type === "supported_by",
    )?.held,
  ).toBe(false);
  const page = renderCardPage(map, map.nodes.get("x") as never);
  expect(page).toContain("Evidence and excerpts");
  expect(page).toContain("x:ex0");
  expect(page).not.toContain("tag-pending-link");
  const shown = (await werk("show", "x")).stdout;
  expect(shown).toContain(`Say:\n  person: ${WORDS}`);
  expect(shown).not.toMatch(/Say:[\s\S]*proposed/);
  // still one accept only
  expect(
    project.events().filter((e) => (e as Ev).type === "node.accepted"),
  ).toHaveLength(2);
});

// ---------------------------------------------------------------- 08
async function removalMap() {
  setLog(
    decided("auth"),
    real("login", { parent: "auth" }),
    real("session", { parent: "auth" }),
    real("audit"),
    link("login", "audit", "depends_on"),
  );
}
const edgeExists = (from: string, to: string) =>
  shapeRead(mapNow()).edges.some((e) => e.from === from && e.to === to);
const inViews = (id: string) =>
  shapeRead(mapNow()).nodes.some((n) => n.id === id) ||
  headerRead(mapNow()).entries.some((n) => n.id === id);

test(
  "08.1 removing a card takes its subtree out in one step, restore brings it back",
  async () => {
    await removalMap();
    const before = lineCount();
    const r = await werk("remove", "auth", ...YOU);
    expect(r.code).toBe(0);
    expect(lineCount()).toBe(before + 1);
    const last = project.events().at(-1) as Ev;
    expect(last.type).toBe("node.removed");
    expect(last.id).toBe("auth");
    for (const id of ["auth", "login", "session"]) {
      expect(await shows(id)).toBe(false);
      expect(inViews(id)).toBe(false);
    }
    const removed = (await werk("removed")).stdout;
    expect(removed).toMatch(/auth \(with .*login/);
    expect(removed).toMatch(/auth \(with .*session/);
    expect(lines(removed)).toHaveLength(1);
    expect(edgeExists("login", "audit")).toBe(false);
    expect((await werk("show", "audit")).stdout).not.toContain("login");

    const rest = await werk("restore", "auth", ...YOU);
    expect(rest.code).toBe(0);
    expect(await shows("auth")).toBe(true);
    expect(parentOf("login")).toBe("auth");
    expect(parentOf("session")).toBe("auth");
    expect((await werk("show", "auth")).stdout).toContain("login");
    expect(edgeExists("login", "audit")).toBe(true);
    expect((await werk("show", "login")).stdout).toContain("audit");
    expect((await werk("removed")).stdout.trim()).toBe("nothing is removed");
  },
  SLOW,
);

test(
  "08.2 removing with reparent moves the children up, restore puts them back",
  async () => {
    setLog(
      real("platform"),
      real("auth", { parent: "platform" }),
      real("login", { parent: "auth" }),
      real("session", { parent: "auth" }),
    );
    const r = await werk("remove", "auth", ...YOU, "--reparent");
    expect(r.code).toBe(0);
    expect(await shows("auth")).toBe(false);
    expect(parentOf("login")).toBe("platform");
    expect(parentOf("session")).toBe("platform");
    const rest = await werk("restore", "auth", ...YOU);
    expect(rest.code).toBe(0);
    expect(parentOf("auth")).toBe("platform");
    expect(parentOf("login")).toBe("auth");
    expect(parentOf("session")).toBe("auth");
    const login = (await werk("show", "login")).stdout;
    expect(login).not.toContain("platform");
  },
  SLOW,
);

test(
  "08.3 a link waits until both of its ends are back",
  async () => {
    setLog(
      real("root-a"),
      real("root-b"),
      real("login", { parent: "root-a" }),
      real("session", { parent: "root-b" }),
      link("login", "session", "depends_on"),
    );
    expect((await werk("remove", "login", ...YOU)).code).toBe(0);
    expect((await werk("remove", "session", ...YOU)).code).toBe(0);
    expect((await werk("restore", "login", ...YOU)).code).toBe(0);
    expect(await shows("login")).toBe(true);
    expect(edgeExists("login", "session")).toBe(false);
    expect((await werk("show", "login")).stdout).not.toContain("session");
    expect((await werk("restore", "session", ...YOU)).code).toBe(0);
    expect(edgeExists("login", "session")).toBe(true);
    expect((await werk("show", "login")).stdout).toContain("session");
  },
  SLOW,
);

test(
  "08.4 a removed id stays taken and a cited source stays",
  async () => {
    setLog(
      real("login"),
      real("billing"),
      real("rfc-6749", { kind: "source", title: "RFC 6749" }),
      link("login", "rfc-6749", "supported_by"),
      link("billing", "rfc-6749", "supported_by"),
    );
    expect((await werk("remove", "login", ...YOU)).code).toBe(0);
    expect(shapeRead(mapNow()).nodes.some((n) => n.id === "rfc-6749")).toBe(
      true,
    );
    expect(await shows("rfc-6749")).toBe(true);
    expect(edgeExists("billing", "rfc-6749")).toBe(true);
    expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
    const before = lineCount();
    const again = await werk("add", "login", "--title", "New login");
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/restore/);
    expect(again.stderr).toContain('"login"');
    expect(lineCount()).toBe(before);
    expect(mapNow().nodes.has("login")).toBe(false);
    expect(await shows("login")).toBe(false);
  },
  SLOW,
);

test("08.5 remove refuses without the person's say-so", async () => {
  setLog(real("login"));
  const before = lineCount();
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(lineCount()).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  setLog(real("login"));
  expect((await werk("remove", "login", ...YOU)).code).toBe(0);
  const before = lineCount();
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(lineCount()).toBe(before);
});

// ---------------------------------------------------------------- 09
test("09.1 search with no term lists the decided cards only", async () => {
  setLog(
    decided("d1", { title: "Decided one" }),
    decided("d2", { title: "Decided two" }),
    decided("d3", { title: "Decided three" }),
    real("o1", { title: "Open card" }),
    // a ghost whose status is decided: only a hand-written line can make one
    ghost("g1", { title: "Ghost card", status: "decided" }),
  );
  expect(mapNow().nodes.get("g1")?.proposed).toBe(true);
  expect(mapNow().nodes.get("g1")?.status).toBe("decided");
  const r = await werk("search");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(3);
  for (const [id, title] of [
    ["d1", "Decided one"],
    ["d2", "Decided two"],
    ["d3", "Decided three"],
  ] as const) {
    expect(out.some((l) => l.includes(id) && l.includes(title))).toBe(true);
  }
  expect(r.stdout).not.toContain("o1");
  expect(r.stdout).not.toContain("Open card");
  expect(r.stdout).not.toContain("g1");
  expect(r.stdout).not.toContain("Ghost card");
});

test("09.2 search with two terms puts the best match first", async () => {
  setLog(
    decided("cache-layout", {
      title: "Cache layout",
      body: "Cache eviction happens by an eviction policy",
    }),
    real("eviction-timer", {
      title: "Eviction timer",
      why: "eviction",
      body: "CACHE warmup",
    }),
    decided("cache-size", { title: "Cache size" }),
    real("cache-gone", { title: "cache eviction" }),
    { type: "node.removed", id: "cache-gone", actor: "you" },
  );
  const r = await werk("search", "cache", "eviction");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(2);
  expect(out[0]).toMatch(/cache-layout\s+\[decided\]\s+Cache layout/);
  expect(out[1]).toMatch(/eviction-timer\s+\[open\]\s+Eviction timer/);
  expect(r.stdout).not.toContain("cache-size");
  expect(r.stdout).not.toContain("cache-gone");
});

test("09.3 search finds a card by a word in a rejected option and narrows", async () => {
  setLog(
    decided("parent-topic", { title: "Parent topic" }),
    ghost("storage", {
      title: "Storage format",
      parent: "parent-topic",
    }),
    ghost("storage:opt0", {
      kind: "option",
      title: "Embedded database",
      why: "SQLite needs a native build",
    }),
    link("storage:opt0", "storage", "alternative_to", ""),
    { type: "node.accepted", id: "storage", actor: "you" },
    { type: "node.edited", id: "storage", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "storage", form: "revisit" },
    { type: "node.decided", id: "storage" },
    real("other", { title: "Other open", body: "we could use sqlite here" }),
  );
  expect(mapNow().nodes.get("storage")?.status).toBe("decided");
  expect(mapNow().nodes.get("storage:opt0")?.proposed).toBe(false);
  const all = await werk("search", "sqlite");
  expect(all.code).toBe(0);
  const out = lines(all.stdout);
  expect(out).toHaveLength(2);
  expect(
    out.some((l) => /storage\s+\[decided\]\s+Storage format/.test(l)),
  ).toBe(true);
  expect(out.some((l) => /other\s+\[open\]/.test(l))).toBe(true);
  const under = lines(
    (await werk("search", "sqlite", "--under", "parent-topic")).stdout,
  );
  expect(under).toHaveLength(1);
  expect(under[0]).toContain("Storage format");
  const status = lines(
    (await werk("search", "sqlite", "--status", "decided")).stdout,
  );
  expect(status).toHaveLength(1);
  expect(status[0]).toContain("Storage format");
});

function findFixture() {
  setLog(
    decided("client", { title: "Client" }),
    real("routing", { title: "Routing", parent: "client" }),
    real("theme", { title: "Theme", parent: "client", status: "proto" }),
    real("guards", { title: "Route guards", parent: "routing" }),
    // an option and a source attached to routing
    ghost("routing:opt0", { kind: "option", title: "Hash routing", why: "w" }),
    link("routing:opt0", "routing", "alternative_to", ""),
    { type: "node.accepted", id: "routing:opt0", actor: "you" },
    real("routing-src", { kind: "source", title: "Router docs" }),
    link("routing", "routing-src", "supported_by", ""),
    // postponed child: decided under client, then reopened as postponed
    decided("later", { title: "Later card", parent: "client" }),
    // paused child: open, depends on the postponed child
    real("waits", { title: "Waits card", parent: "client" }),
    link("waits", "later", "depends_on"),
    // stale child: open, depends on a decided card in another tree that is rejected
    decided("basis", { title: "Basis card" }),
    real("stale-one", { title: "Stale card", parent: "client" }),
    link("stale-one", "basis", "depends_on"),
    reopen("later", "postponed"),
    reopen("basis", "rejected"),
    real("billing", { title: "Billing" }),
  );
}

test("09.4 find lists the open work under one card", async () => {
  findFixture();
  const map = mapNow();
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("later")?.marks.map((m) => m.kind)).toContain(
    "postponed",
  );
  expect(map.nodes.get("waits")?.marks.map((m) => m.kind)).toContain("paused");
  expect(map.nodes.get("stale-one")?.marks.map((m) => m.kind)).toContain(
    "stale",
  );

  const r = await werk("find", "routing");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out[0]).toMatch(/^routing\s/);
  expect(out[1]).toMatch(/^guards\s/);
  expect(out).toHaveLength(2);
  for (const nope of [
    "billing",
    "routing:opt0",
    "Hash routing",
    "routing-src",
    "Router docs",
  ])
    expect(r.stdout).not.toContain(nope);

  const c = await werk("find", "client");
  expect(c.code).toBe(0);
  const co = lines(c.stdout);
  const idx = (id: string) => co.findIndex((l) => l.startsWith(`${id} `));
  expect(idx("routing")).toBeGreaterThanOrEqual(0);
  expect(idx("theme")).toBeGreaterThanOrEqual(0);
  expect(idx("guards")).toBeGreaterThan(idx("routing"));
  expect(idx("guards")).toBeGreaterThan(idx("theme"));
  expect(idx("client")).toBe(-1);
  for (const id of ["later", "waits", "stale-one", "billing"])
    expect(idx(id)).toBe(-1);
  expect(co).toHaveLength(3);
});

test("09.5 a card reopened as rejected comes back as work in every tree", async () => {
  setLog(
    real("tree-a", { title: "Tree A open" }),
    real("tree-b", { title: "Tree B open" }),
    decided("auth-flow", { title: "Auth flow" }),
    reopen("auth-flow", "rejected"),
  );
  const r = await werk("find");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("tree-a "))).toBe(true);
  expect(out.some((l) => l.startsWith("tree-b "))).toBe(true);
  expect(out.some((l) => l.startsWith("auth-flow "))).toBe(true);
  expect(r.stdout).not.toContain("[decided]");
});

// ---------------------------------------------------------------- 11
const rollupLines = (s: string) =>
  s.split("\n").filter((l) => l.startsWith("rollup:"));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  setLog(
    decided("root", { title: "Root card" }),
    // a card cannot be decided under an open parent, so c1 is decided, then reopened
    decided("c1", { title: "Child one", parent: "root" }),
    real("c2", { title: "Child two", parent: "root", status: "proto" }),
    decided("g1", { title: "Grandchild", parent: "c1" }),
    reopen("c1", "invalidated"),
  );
  expect(mapNow().problems).toEqual([]);
  const r = await werk("show", "root");
  expect(r.code).toBe(0);
  const own = rollupLines(r.stdout);
  expect(own).toHaveLength(1);
  expect(own[0]).toBe("rollup: 4 cards: 1 open, 1 proto, 2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  setLog(
    real("parent", { title: "Parent card" }),
    real("child", { title: "Child card", parent: "parent" }),
    real("gc-open", { title: "Open grandchild", parent: "child" }),
    decided("gc-dec", { title: "Decided grandchild", parent: "child" }),
  );
  const r = await werk("show", "parent");
  const row = r.stdout.split("\n").find((l) => /<- refines\s+child\b/.test(l));
  expect(row).toBeDefined();
  expect(row).toContain("(rollup: 3 cards:");
  expect(row).not.toContain("4 cards");
  expect(rollupLines(r.stdout)[0]).toMatch(/^rollup: 4 cards:/);
});

test("11.3 a card prints its options, excerpts and a proposed source with words", async () => {
  setLog(
    real("other", { title: "Other card" }),
    real("x", { title: "Card x" }),
    link("x", "other", "depends_on", "x needs other because of reasons"),
    ghost("x:opt0", {
      kind: "option",
      title: "Use a queue",
      why: "a queue loses order",
    }),
    link("x:opt0", "x", "alternative_to", ""),
    { type: "node.accepted", id: "x:opt0", actor: "you" },
    ghost("x-src", {
      kind: "source",
      title: "Benchmark report",
      why: "it shows 2x speed",
    }),
    link("x", "x-src", "supported_by", ""),
  );
  chat("pricing", spoken(`yes: ${WORDS}`));
  expect((await werk("quote", "x", "pricing", WORDS)).code).toBe(0);
  const out = (await werk("show", "x")).stdout;
  const at = (s: string) => out.indexOf(s);
  expect(out).toMatch(/-> depends_on\s+other\s+Other card/);
  expect(out).toContain("why: x needs other because of reasons");
  expect(at("Options:")).toBeGreaterThan(at("-> depends_on"));
  expect(out).toContain("Use a queue");
  expect(out).toContain("why not: a queue loses order");
  expect(at("Say:")).toBeGreaterThan(at("Options:"));
  expect(out).toContain(`person: ${WORDS}`);
  expect(at("Ev:")).toBeGreaterThan(at("Say:"));
  expect(out).toMatch(/Benchmark report\s+proposed/);
  expect(out).toContain("finding: it shows 2x speed");
});

test("11.4 a card with no options prints no Options section", async () => {
  setLog(
    real("x", { title: "Card x" }),
    real("x-src", { kind: "source", title: "Report", why: "finding here" }),
    link("x", "x-src", "supported_by", ""),
  );
  chat("pricing", spoken(`yes: ${WORDS}`));
  expect((await werk("quote", "x", "pricing", WORDS)).code).toBe(0);
  const out = (await werk("show", "x")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  setLog(
    real("rt", { title: "The root title" }),
    real("kid", { title: "The kid", parent: "rt" }),
    real("grandkid", { title: "Grandkid", parent: "kid" }),
  );
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root title");
  expect(rollupLines(r.stdout)[0]).toBe(
    "rollup: 3 cards: 3 open, 0 proto, 0 decided",
  );
  const row = r.stdout.split("\n").find((l) => /<- refines\s+kid\b/.test(l));
  expect(row).toBeDefined();
  expect(row).toContain("(rollup: 2 cards:");
});

void cardRead;
