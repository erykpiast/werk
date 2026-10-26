import { appendFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk, decide, must } = werkHarness();

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  await decide("auth");
  const before = project().events().length;
  const added = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(project().events().length).toBe(before + 1);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("auth");
  expect(shown.stdout).toMatch(/rollup/i);
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  await decide("auth");
  await must("add", "login", "--title", "First words", "--parent", "auth");
  const n = project().events().length;
  const again = await werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toMatch(/duplicate/i);
  expect(project().events().length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  await decide("auth");
  const n = project().events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/decided/i);
  expect(project().events().length).toBe(n);
  const shown = await werk("show", "pay");
  expect(shown.stdout + shown.stderr).toMatch(/not found|unknown/i);
});

test("05.4 a hash sign on an id is optional but a title keeps its hash", async () => {
  await must("add", "auth", "--title", "Auth");
  const r = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(r.stdout.trim()).toBe("proposed");
  const a = await werk("show", "#login");
  const b = await werk("show", "login");
  expect(a.stdout).toBe(b.stdout);
  expect(a.stdout).toContain("#1 priority: magic links");
  expect(a.stdout).toContain("auth");
});

test("05.5 a hand-written bad line is a problem and later cards still show", async () => {
  await must("add", "auth", "--title", "Auth");
  appendFileSync(
    project().logPath,
    `${JSON.stringify({ type: "node.proposed", id: "orphan", kind: "card", title: "Orphan", status: "open", parent: "nowhere" })}\n`,
  );
  await must("add", "login", "--title", "Login");
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("proposed");
  // The only way the CLI reports the map's problems is `show`, which prints each one to stderr.
  expect(shown.stderr).toMatch(/problem at log line 2/);
  expect(shown.stderr).toMatch(/unknown-card|parent/i);
  const log = await Bun.file(project().logPath).text();
  expect(log).toContain("nowhere");
});
