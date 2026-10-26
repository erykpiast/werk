import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Cli, cli, decided } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
});
afterEach(() => c.dispose());

test("05.1 add a card under a parent and read it back", async () => {
  c.write(decided("auth"));
  const before = c.events().length;
  const added = await c.werk("add", "login", "--title", "Use magic links", "--why", "w", "--parent", "auth");
  expect(added.stdout.trim()).toBe("proposed");
  expect(c.events().length).toBe(before + 1);
  const shown = await c.werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toMatch(/refines\s+auth/);
  expect(shown.stdout).toContain("rollup");
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  c.write(decided("auth"));
  await c.werk("add", "login", "--title", "First words", "--parent", "auth");
  const n = c.events().length;
  const again = await c.werk("add", "login", "--title", "Second words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(c.events().length).toBe(n);
  expect((await c.werk("show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  c.write(decided("auth"));
  const n = c.events().length;
  const r = await c.werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/);
  expect(r.stderr).toMatch(/not .*add|only through the status verb/);
  expect(c.events().length).toBe(n);
  const shown = await c.werk("show", "pay");
  expect(shown.stdout + shown.stderr).toMatch(/not found|unknown card/);
});

test("05.4 a hash sign on an id is optional and a title keeps its hash sign", async () => {
  c.write(decided("auth"));
  const r = await c.werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = await c.werk("show", "#login");
  const b = await c.werk("show", "login");
  expect(a.stdout).toBe(b.stdout);
  expect(a.stdout).toMatch(/refines\s+auth/);
  expect(a.stdout).toContain("#1 priority: magic links");
});

test("05.5 a bad hand-written line is a listed problem and later cards still show", async () => {
  c.write([
    ...decided("auth"),
    JSON.stringify({ type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" }),
    { type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open", parent: "auth" },
  ]);
  const bad = c.events().findIndex((e) => (e as { id?: string }).id === "orphan") + 1;
  const shown = await c.werk("show", "login");
  expect(shown.stdout).toContain("login");
  expect(shown.stdout).toContain("proposed");
  // The problems of the map are listed by show on stderr.
  expect(shown.stderr).toContain(`log line ${bad}`);
  expect(shown.stderr).toContain("unknown-card");
  const raw = await Bun.file(c.project.logPath).text();
  expect(raw).toContain('"orphan"');
});
