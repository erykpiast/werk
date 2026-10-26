import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { decidedCard, harness, logLines, real, writeLog, YOU, proposed } from "./util.ts";

const { project, werk } = harness();
const SLOW = 60_000;

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  writeLog(project(), decidedCard("auth"));
  const before = logLines(project()).length;
  const add = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(add.stdout).toContain("proposed");
  expect(logLines(project()).length).toBe(before + 1);
  const shown = (await werk("show", "login")).stdout;
  expect(shown).toContain("Use magic links");
  expect(shown).toContain("[open]");
  expect(shown).toContain("proposed");
  expect(shown).toContain("auth");
  expect(shown).toContain("rollup:");
}, SLOW);

test("05.2 a second add with the same id is refused and the log stays", async () => {
  await werk("add", "login", "--title", "First words");
  const n = logLines(project()).length;
  const again = await werk("add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr.toLowerCase()).toMatch(/duplicate|already|exists/);
  expect(logLines(project()).length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
}, SLOW);

test("05.3 a decided status is refused on add", async () => {
  writeLog(project(), decidedCard("auth"));
  const n = logLines(project()).length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not.*add|add/);
  expect(logLines(project()).length).toBe(n);
  const shown = await werk("show", "pay");
  expect(shown.stderr + shown.stdout).toMatch(/unknown card|not found/);
}, SLOW);

test("05.4 a hash sign on an id is optional, a title keeps its hash sign", async () => {
  writeLog(project(), real("auth"));
  const add = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(add.stdout).toContain("proposed");
  const a = (await werk("show", "#login")).stdout;
  const b = (await werk("show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toContain("auth");
  expect(a).toContain("#1 priority: magic links");
}, SLOW);

test("05.5 a hand-written bad line is listed as a problem and later cards still show", async () => {
  writeLog(project(), real("auth"), proposed("orphan", { parent: "nowhere" }), proposed("login", { parent: "auth" }));
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("login");
  expect(shown.stdout).toContain("proposed");
  // The only place the command line lists the map's problems is the stderr of show.
  expect(shown.stderr).toMatch(/problem at log line 3: [a-z-]+: /);
  expect(shown.stderr).toContain("nowhere");
  expect(logLines(project()).some((l) => l.includes('"orphan"'))).toBe(true);
}, SLOW);
