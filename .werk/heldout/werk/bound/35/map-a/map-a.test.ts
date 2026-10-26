import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMap } from "../../src/map/log-store.ts";
import { decided, ghost, link, open } from "../../src/map/mark-fixtures.ts";
import { shapeRead } from "../../src/serve/read-api.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

/** Writes events straight into the log, one per line. */
function writeLog(...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`)
      .join(""),
  );
}
const logText = () => readFileSync(project.logPath, "utf8");
const shape = () => shapeRead(readMap(project.logPath).map);
const hasEdge = (from: string, to: string) =>
  shape().edges.some((e) => e.from === from && e.to === to && !e.held);
const inMap = (id: string) => shape().nodes.some((n) => n.id === id);

// ---------- 05 ----------

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  writeLog(decided("auth"));
  const before = project.events().length;
  const added = await werk(
    "add",
    "login",
    "--title",
    "Use magic links",
    "--parent",
    "auth",
  );
  expect(added.stdout.trim()).toBe("proposed");
  expect(project.events().length).toBe(before + 1);
  const shown = (await werk("show", "login")).stdout;
  expect(shown).toContain("Use magic links");
  expect(shown).toMatch(/proposed/);
  expect(shown).toMatch(/auth/);
  expect(shown).toMatch(/rollup:/);
});

test("05.2 a second add with the same id is refused and the log stays as it was", async () => {
  writeLog(decided("auth"));
  await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  const before = project.events().length;
  const text = logText();
  const again = await werk("add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(project.events().length).toBe(before);
  expect(logText()).toBe(text);
  expect((await werk("show", "login")).stdout).toContain("Use magic links");
});

test("05.3 a decided status is refused on add", async () => {
  writeLog(decided("auth"));
  const before = project.events().length;
  const res = await werk(
    "add",
    "pay",
    "--title",
    "Pay",
    "--parent",
    "auth",
    "--status",
    "decided",
  );
  expect(res.code).not.toBe(0);
  expect(res.stderr).toMatch(/decided/);
  expect(res.stderr).toMatch(/not add/);
  expect(project.events().length).toBe(before);
  const shown = await werk("show", "pay");
  expect(`${shown.stdout}${shown.stderr}`).toMatch(/unknown card|not found/);
});

test("05.4 a hash sign on an id is optional, a title keeps its hash sign", async () => {
  writeLog(decided("auth"));
  const added = await werk(
    "add",
    "#login",
    "--title",
    "#1 priority: magic links",
    "--parent",
    "#auth",
  );
  expect(added.stdout.trim()).toBe("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toMatch(/-> refines\s+auth/);
});

test("05.5 a hand-written bad line is listed as a problem and later cards still show", async () => {
  writeLog(
    ghost("auth"),
    ghost("orphan", { parent: "nowhere" }),
    ghost("login"),
  );
  const shown = await werk("show", "login");
  expect(shown.stdout).toMatch(/login\s+\[open\]\s+proposed/);
  // The only way the product lists the problems of the map is the show output.
  expect(shown.stderr).toMatch(/problem at log line 2/);
  expect(shown.stderr).toContain("unknown-card");
  expect(logText().split("\n")[1]).toContain("orphan");
});

// ---------- 06 ----------

const spoken = (text: string) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
});
function chat(name: string, ...lines: unknown[]) {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
}

test("06.1 a new excerpt stages as a ghost and waits for the accept", async () => {
  writeLog(decided("x", { title: "We charge per seat" }));
  chat("pricing", spoken("yes: seats are the unit we bill"));
  const res = await werk("quote", "x", "pricing", "seats are the unit");
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("proposed");
  expect(res.stdout).not.toContain("added");
  const node = shape().nodes.find((n) => n.id === "x:ex0");
  expect(node?.proposed).toBe(true);
  const edge = shape().edges.find((e) => e.from === "x" && e.to === "x:ex0");
  expect(edge?.held).toBe(true);
  const shown = (await werk("show", "x")).stdout;
  expect(shown).toContain("[decided]");
  expect(shown).toContain("We charge per seat".slice(0, 5));
  expect(shown).toMatch(/Say:\n\s+person: seats are the unit\s+proposed/);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  writeLog(decided("x", { title: "We charge per seat" }));
  chat("pricing", spoken("yes: seats are the unit we bill"));
  await werk("quote", "x", "pricing", "seats are the unit");
  const accepted = await werk("accept", "x:ex0", "--actor", "you");
  expect(accepted.code).toBe(0);
  expect(shape().nodes.find((n) => n.id === "x:ex0")?.proposed).toBe(false);
  const shown = (await werk("show", "x")).stdout;
  expect(shown).toMatch(/Say:\n\s+person: seats are the unit/);
  expect(shown).not.toMatch(/Say:\n[^\n]*proposed/);
  const edge = shape().edges.find((e) => e.from === "x" && e.to === "x:ex0");
  expect(edge?.held).toBe(false);
});

// ---------- 08 ----------

const tree = () =>
  writeLog(
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
  );
const refused = (r: { code: number }) => expect(r.code).not.toBe(0);

test("08.1 removing a card takes its subtree out in one step, and a restore brings everything back", async () => {
  tree();
  writeLog(
    decided("auth"),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
    open("audit"),
    link("login", "audit"),
  );
  const before = project.events().length;
  const rm = await werk("remove", "auth", "--actor", "you");
  expect(rm.code).toBe(0);
  for (const id of ["auth", "login", "session"]) expect(inMap(id)).toBe(false);
  expect((await werk("show", "login")).code).not.toBe(0);
  expect(project.events().length).toBe(before + 1);
  const removed = (await werk("removed")).stdout;
  expect(removed).toContain("auth");
  expect(removed).toContain("login");
  expect(removed).toContain("session");
  expect(hasEdge("login", "audit")).toBe(false);
  const back = await werk("restore", "auth", "--actor", "you");
  expect(back.code).toBe(0);
  const shown = (await werk("show", "auth")).stdout;
  expect(shown).toContain("login");
  expect(shown).toContain("session");
  expect(hasEdge("login", "audit")).toBe(true);
  expect((await werk("removed")).stdout.trim()).toBe("nothing is removed");
});

test("08.2 removing with reparent moves the children up, and a restore puts them back", async () => {
  writeLog(
    decided("platform"),
    open("auth", { parent: "platform" }),
    open("login", { parent: "auth" }),
    open("session", { parent: "auth" }),
  );
  const rm = await werk("remove", "auth", "--actor", "you", "--reparent");
  expect(rm.code).toBe(0);
  expect(inMap("auth")).toBe(false);
  expect(hasEdge("login", "platform")).toBe(true);
  expect(hasEdge("session", "platform")).toBe(true);
  expect((await werk("restore", "auth", "--actor", "you")).code).toBe(0);
  expect(hasEdge("auth", "platform")).toBe(true);
  expect(hasEdge("login", "auth")).toBe(true);
  expect(hasEdge("session", "auth")).toBe(true);
  expect(hasEdge("login", "platform")).toBe(false);
  expect(hasEdge("session", "platform")).toBe(false);
});

test("08.3 a link waits until both of its ends are back", async () => {
  writeLog(
    decided("root"),
    open("a", { parent: "root" }),
    open("b", { parent: "root" }),
    open("login", { parent: "a" }),
    open("session", { parent: "b" }),
    link("login", "session"),
  );
  await werk("remove", "login", "--actor", "you");
  await werk("remove", "session", "--actor", "you");
  await werk("restore", "login", "--actor", "you");
  expect(inMap("login")).toBe(true);
  expect(hasEdge("login", "session")).toBe(false);
  await werk("restore", "session", "--actor", "you");
  expect(hasEdge("login", "session")).toBe(true);
});

test("08.4 a removed card's id stays taken, and a cited source stays", async () => {
  writeLog(
    decided("root"),
    open("login", { parent: "root" }),
    open("billing", { parent: "root" }),
    open("rfc-6749", { kind: "source" }),
    link("login", "rfc-6749", "supported_by"),
    link("billing", "rfc-6749", "supported_by"),
  );
  expect((await werk("remove", "login", "--actor", "you")).code).toBe(0);
  expect(inMap("rfc-6749")).toBe(true);
  expect(hasEdge("billing", "rfc-6749")).toBe(true);
  expect((await werk("show", "billing")).stdout).toContain("rfc-6749");
  const before = project.events().length;
  const add = await werk("add", "login", "--title", "Again");
  refused(add);
  expect(add.stderr).toMatch(/"login".*restore/);
  expect(project.events().length).toBe(before);
  expect(inMap("login")).toBe(false);
});

test("08.5 remove refuses without the person's say-so", async () => {
  writeLog(decided("login"));
  const before = project.events().length;
  refused(await werk("remove", "login"));
  expect(inMap("login")).toBe(true);
  expect(project.events().length).toBe(before);
});

test("08.6 restore refuses without the person's say-so", async () => {
  writeLog(decided("login"));
  await werk("remove", "login", "--actor", "you");
  const before = project.events().length;
  refused(await werk("restore", "login"));
  expect(inMap("login")).toBe(false);
  expect(project.events().length).toBe(before);
});
