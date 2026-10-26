import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, open } from "../src/map/mark-fixtures.ts";
import { createProject, logText, type Project, problems, seed, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  seed(p, decided("auth"));
  const before = p.events().length;
  const r = await werk(p, "add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(r.stdout.trim()).toBe("proposed");
  expect(p.events().length).toBe(before + 1);
  const s = await werk(p, "show", "login");
  expect(s.stdout).toContain("Use magic links");
  expect(s.stdout).toContain("proposed");
  expect(s.stdout).toMatch(/refines\s+auth/);
  expect(s.stdout).toContain("rollup");
});

test("05.2 a second add with the same id is refused", async () => {
  seed(p, decided("auth"));
  await werk(p, "add", "login", "--title", "First words", "--parent", "auth");
  const n = p.events().length;
  const r = await werk(p, "add", "login", "--title", "Other words");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("duplicate-id");
  expect(p.events().length).toBe(n);
  expect((await werk(p, "show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  seed(p, decided("auth"));
  const n = p.events().length;
  const r = await werk(p, "add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not|only/);
  expect(p.events().length).toBe(n);
  const s = await werk(p, "show", "pay");
  expect(`${s.stdout}${s.stderr}`).toMatch(/unknown card|not found/i);
});

test("05.4 hash on id optional, title keeps hash", async () => {
  seed(p, open("auth"));
  const r = await werk(p, "add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = await werk(p, "show", "#login");
  const b = await werk(p, "show", "login");
  expect(a.stdout).toBe(b.stdout);
  expect(a.stdout).toMatch(/refines\s+auth/);
  expect(a.stdout).toContain("#1 priority: magic links");
});

test("05.5 a hand-written bad line is a problem and later cards show", async () => {
  seed(
    p,
    open("auth"),
    ghost("bad", { parent: "nowhere" }),
    ghost("login", { parent: "auth" }),
  );
  const s = await werk(p, "show", "login");
  expect(s.stdout).toContain("proposed");
  expect(s.stdout).toContain("login");
  // "asks for the problems of the map": show prints each problem, or the read api
  const all = s.stderr;
  expect(all).toMatch(/log line 3/);
  expect(all).toMatch(/unknown-card/);
  expect(problems(p).length).toBe(1);
  expect(logText(p)).toContain('"id":"bad"');
});
