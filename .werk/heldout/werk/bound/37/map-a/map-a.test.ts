import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, open } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const SLOW = 60_000;
const YOU = ["--actor", "you"];
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const writeLog = (...events: unknown[]) => {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`)
      .join(""),
  );
};
const card = async (id: string, parent?: string) => {
  await werk("add", id, "--title", id, ...(parent ? ["--parent", parent] : []));
  await werk("accept", id, ...YOU);
};
const shows = async (id: string) => (await werk("show", id)).code === 0;

// ---- 05 ----
test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  writeLog(decided("auth"));
  const before = project.events().length;
  const added = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(added.stdout.trim()).toBe("proposed");
  expect(project.events()).toHaveLength(before + 1);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toMatch(/proposed/);
  expect(shown.stdout).toMatch(/refines\s+auth/);
  expect(shown.stdout).toContain("rollup:");
}, SLOW);

test("05.2 a second add with the same id is refused and the log stays", async () => {
  writeLog(decided("auth"));
  await werk("add", "login", "--title", "First words", "--parent", "auth");
  const before = project.events().length;
  const again = await werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(project.events()).toHaveLength(before);
  expect((await werk("show", "login")).stdout).toContain("First words");
}, SLOW);

test("05.3 a decided status is refused on add", async () => {
  writeLog(decided("auth"));
  const before = project.events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not add/);
  expect(project.events()).toHaveLength(before);
  const shown = await werk("show", "pay");
  expect(shown.stderr + shown.stdout).toMatch(/unknown card|not found/);
}, SLOW);

test("05.4 hash on id optional, title keeps its hash", async () => {
  writeLog(open("auth"));
  const r = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toMatch(/refines\s+auth/);
}, SLOW);

test("05.5 a hand-written bad line is listed as a problem and later cards show", async () => {
  writeLog(
    open("auth"),
    JSON.stringify({ type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" }),
    open("login", { title: "Login" }).slice(0, 1),
  );
  const before = readFileSync(project.logPath, "utf8");
  const shown = await werk("show", "login");
  expect(shown.stdout).toMatch(/card login\s+\[open\]\s+proposed/);
  expect(shown.stderr).toMatch(/problem at log line 3/);
  expect(shown.stderr).toMatch(/problem at log line 3: [a-z-]+:/);
  expect(readFileSync(project.logPath, "utf8")).toBe(before);
  expect(readFileSync(project.logPath, "utf8")).toContain("nowhere");
}, SLOW);

// ---- 06 ----
const spoken = (text: string) => ({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text });
const chat = (name: string, ...lines: unknown[]) => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
};

test("06.1 a new excerpt stages as a ghost with a pending link", async () => {
  writeLog(decided("x", { title: "We charge per seat" }));
  chat("pricing", spoken("yes: seats are the unit we bill"));
  const r = await werk("quote", "x", "pricing", "seats are the unit we bill");
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = (await werk("show", "x:ex0")).stdout;
  expect(ex).toMatch(/proposed/);
  const cardView = (await werk("show", "x")).stdout;
  expect(cardView).toMatch(/Say:\n\s+person: seats are the unit we bill\s+proposed/);
  expect(cardView).toMatch(/card x\s+\[decided\]/);
  expect(cardView).toContain("We charge per seat");
  expect(cardView).not.toMatch(/card x.*proposed/);
}, SLOW);

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  writeLog(decided("x", { title: "We charge per seat" }));
  chat("pricing", spoken("yes: seats are the unit we bill"));
  await werk("quote", "x", "pricing", "seats are the unit we bill");
  const acc = await werk("accept", "x:ex0", ...YOU);
  expect(acc.code).toBe(0);
  const ex = (await werk("show", "x:ex0")).stdout;
  expect(ex).not.toMatch(/proposed/);
  const cardView = (await werk("show", "x")).stdout;
  expect(cardView).toContain("Say:\n  person: seats are the unit we bill");
  expect(cardView).not.toMatch(/Say:[\s\S]*proposed/);
  expect(cardView).not.toContain("[held]");
}, SLOW);

// ---- 08 ----
test("08.1 removing a card takes the subtree in one step; restore brings it back", async () => {
  await card("auth");
  await card("login", "auth");
  await card("session", "auth");
  await card("audit");
  await werk("link", "login", "audit", "--type", "depends_on", "--why", "w");
  const before = project.events().length;
  expect((await werk("remove", "auth", ...YOU)).code).toBe(0);
  const evs = project.events() as { type: string }[];
  expect(evs).toHaveLength(before + 1);
  expect(evs.at(-1)?.type).toBe("node.removed");
  for (const id of ["auth", "login", "session"]) expect(await shows(id)).toBe(false);
  expect((await werk("show", "audit")).stdout).not.toContain("login");
  const removed = (await werk("removed")).stdout;
  expect(removed).toMatch(/auth \(with .*login.*\)/);
  expect(removed).toContain("session");
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  expect((await werk("show", "login")).stdout).toMatch(/refines\s+auth/);
  expect((await werk("show", "session")).stdout).toMatch(/refines\s+auth/);
  expect((await werk("show", "login")).stdout).toContain("audit");
  expect((await werk("removed")).stdout).toContain("nothing is removed");
}, SLOW);

test("08.2 removing with reparent moves children up; restore puts them back", async () => {
  await card("platform");
  await card("auth", "platform");
  await card("login", "auth");
  await card("session", "auth");
  expect((await werk("remove", "auth", ...YOU, "--reparent")).code).toBe(0);
  expect(await shows("auth")).toBe(false);
  expect((await werk("show", "login")).stdout).toMatch(/refines\s+platform/);
  expect((await werk("show", "session")).stdout).toMatch(/refines\s+platform/);
  expect((await werk("restore", "auth", ...YOU)).code).toBe(0);
  expect((await werk("show", "auth")).stdout).toMatch(/refines\s+platform/);
  const login = (await werk("show", "login")).stdout;
  expect(login).toMatch(/refines\s+auth/);
  expect(login).not.toMatch(/refines\s+platform/);
  const session = (await werk("show", "session")).stdout;
  expect(session).toMatch(/refines\s+auth/);
  expect(session).not.toMatch(/refines\s+platform/);
}, SLOW);

test("08.3 a link waits until both ends are back", async () => {
  await card("root");
  await card("a", "root");
  await card("b", "root");
  await card("login", "a");
  await card("session", "b");
  await werk("link", "login", "session", "--type", "depends_on", "--why", "w");
  await werk("remove", "login", ...YOU);
  await werk("remove", "session", ...YOU);
  await werk("restore", "login", ...YOU);
  const login = await werk("show", "login");
  expect(login.code).toBe(0);
  expect(login.stdout).not.toContain("session");
  await werk("restore", "session", ...YOU);
  expect((await werk("show", "login")).stdout).toContain("session");
}, SLOW);

test("08.4 a removed id stays taken and a cited source stays", async () => {
  await card("login");
  await card("billing");
  await werk("add", "rfc-6749", "--kind", "source", "--title", "RFC 6749");
  await werk("accept", "rfc-6749", ...YOU);
  await werk("link", "login", "rfc-6749", "--type", "supported_by");
  await werk("link", "billing", "rfc-6749", "--type", "supported_by");
  await werk("remove", "login", ...YOU);
  const billing = (await werk("show", "billing")).stdout;
  expect(billing).toContain("rfc-6749");
  expect((await werk("show", "rfc-6749")).code).toBe(0);
  const before = project.events().length;
  const again = await werk("add", "login", "--title", "New");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toMatch(/restore it|restore "login"/);
  expect(again.stderr).toContain('"login"');
  expect(project.events()).toHaveLength(before);
  expect(await shows("login")).toBe(false);
}, SLOW);

test("08.5 remove refuses without --actor you", async () => {
  await card("login");
  const before = project.events().length;
  const r = await werk("remove", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(true);
  expect(project.events()).toHaveLength(before);
}, SLOW);

test("08.6 restore refuses without --actor you", async () => {
  await card("login");
  await werk("remove", "login", ...YOU);
  const before = project.events().length;
  const r = await werk("restore", "login");
  expect(r.code).not.toBe(0);
  expect(await shows("login")).toBe(false);
  expect(project.events()).toHaveLength(before);
}, SLOW);
