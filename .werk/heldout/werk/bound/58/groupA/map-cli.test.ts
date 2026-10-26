import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { decided, ghost, open, werk, writeLog } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  writeLog(p, decided("auth"));
  const before = p.events().length;
  const add = await werk(p, "add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(add.stdout.trim()).toBe("proposed");
  expect(p.events().length).toBe(before + 1);
  const show = await werk(p, "show", "login");
  expect(show.stdout).toContain("Use magic links");
  expect(show.stdout).toContain("proposed");
  expect(show.stdout).toMatch(/refines\s+auth/);
  expect(show.stdout).toMatch(/^rollup:/m);
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  writeLog(p, open("root"));
  await werk(p, "add", "login", "--title", "First words", "--parent", "root");
  const n = p.events().length;
  const again = await werk(p, "add", "login", "--title", "Other words");
  expect(again.code).not.toBe(0);
  expect(again.stderr.toLowerCase()).toMatch(/duplicate|already|taken|exists/);
  console.log("05.2 message:", again.stderr.trim());
  expect(p.events().length).toBe(n);
  expect((await werk(p, "show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  writeLog(p, decided("auth"));
  const n = p.events().length;
  const r = await werk(p, "add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not.*add|only through the status verb/);
  console.log("05.3 message:", r.stderr.trim());
  expect(p.events().length).toBe(n);
  const show = await werk(p, "show", "pay");
  console.log("05.3 show:", show.stdout, show.stderr);
  expect(show.stdout + show.stderr).toMatch(/not found|unknown card/);
});

test("05.4 hash on id optional, title keeps its hash", async () => {
  writeLog(p, open("auth"));
  const r = await werk(p, "add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = (await werk(p, "show", "#login")).stdout;
  const b = (await werk(p, "show", "login")).stdout;
  expect(a).toBe(b);
  expect(a).toMatch(/refines\s+auth/);
  expect(a).toContain("#1 priority: magic links");
});

test("05.5 a hand-written bad line is listed as a problem and later cards show", async () => {
  writeLog(
    p,
    ghost("auth"),
    { type: "node.accepted", id: "auth", actor: "you" },
    { type: "node.proposed", id: "bad", kind: "card", title: "Bad", status: "open", parent: "nowhere" },
    ghost("login", { parent: "auth" }),
  );
  const before = readFileSync(p.logPath, "utf8");
  const show = await werk(p, "show", "login");
  expect(show.stdout).toContain("card login");
  expect(show.stdout).toContain("proposed");
  // The only place the product lists map problems is show's stderr.
  const probs = show.stderr;
  console.log("05.5 problems:", probs.trim());
  expect(probs).toMatch(/log line 3/);
  expect(probs).toMatch(/problem at log line 3: [\w-]+:/);
  expect(readFileSync(p.logPath, "utf8")).toBe(before);
  expect(readFileSync(p.logPath, "utf8")).toContain('"id":"bad"');
});
