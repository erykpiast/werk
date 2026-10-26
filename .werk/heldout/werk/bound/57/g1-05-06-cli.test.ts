import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, open } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const write = (events: unknown[]) => {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(project.logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  write(decided("auth"));
  const before = project.events().length;
  const added = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(added.stdout.trim()).toBe("proposed");
  expect(project.events().length).toBe(before + 1);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("auth");
  expect(shown.stdout.toLowerCase()).toContain("rollup");
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  write(decided("auth"));
  await werk("add", "login", "--title", "First words", "--parent", "auth");
  const n = project.events().length;
  const again = await werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(project.events().length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  write(decided("auth"));
  const n = project.events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not.*add|only through the status verb/);
  expect(project.events().length).toBe(n);
  const shown = await werk("show", "pay");
  expect(shown.stderr + shown.stdout).toMatch(/not found|unknown card/);
});

test("05.4 a hash sign on an id is optional, a title keeps its hash sign", async () => {
  write(open("auth"));
  const r = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("#1 priority: magic links");
  expect(a).toMatch(/refines.*auth/);
});

test("05.5 a hand-written bad line is listed as a problem, later cards still show", async () => {
  write(open("auth"));
  appendFileSync(
    project.logPath,
    `${JSON.stringify({ type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" })}\n`,
  );
  appendFileSync(
    project.logPath,
    `${JSON.stringify({ type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open", parent: "auth" })}\n`,
  );
  const before = readFileSync(project.logPath, "utf8");
  const shown = await werk("show", "login");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("proposed");
  // The problems of the map are listed by show.
  expect(shown.stderr).toMatch(/problem at log line 3/);
  expect(shown.stderr).toContain("unknown-card");
  expect(readFileSync(project.logPath, "utf8")).toBe(before);
});

const chat = () => {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
};

test("06.1 a new excerpt stages as a ghost and the card keeps its status and words", async () => {
  write(decided("auth", { title: "Auth card", why: "Why words" }));
  chat();
  const r = await werk("quote", "auth", "pricing", "seats are the unit we bill");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = (await werk("show", "auth:ex0")).stdout;
  expect(ex).toContain("proposed");
  const card = (await werk("show", "auth")).stdout;
  expect(card).toContain("Auth card");
  expect(card).toContain("Why words");
  expect(card).toContain("decided");
  expect(card).toMatch(/Say:[\s\S]*seats are the unit we bill[\s\S]*proposed/);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live (CLI)", async () => {
  write(decided("auth", { title: "Auth card" }));
  chat();
  await werk("quote", "auth", "pricing", "seats are the unit we bill");
  const acc = await werk("accept", "auth:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = (await werk("show", "auth:ex0")).stdout;
  expect(ex).not.toContain("proposed");
  const card = (await werk("show", "auth")).stdout;
  expect(card).toContain("seats are the unit we bill");
  expect(card).not.toContain("proposed");
});
