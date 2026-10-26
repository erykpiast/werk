import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { useProject } from "../../src/test-env/project.ts";
import { decided, werkIn } from "./05-08-helpers.ts";

const project = useProject();
const werk = (...a: string[]) => werkIn(project())(...a);

test("05.1 an agent proposes a card under a parent and reads it back", async () => {
  await decided(werk, "auth", "Auth");
  const before = project().events().length;
  const add = await werk("add", "login", "--title", "Use magic links", "--parent", "auth");
  expect(add.stdout.trim()).toBe("proposed");
  expect(project().events().length).toBe(before + 1);
  const shown = await werk("show", "login");
  expect(shown.stdout).toContain("Use magic links");
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toMatch(/refines\s+auth/);
  expect(shown.stdout).toContain("rollup");
});

test("05.2 a second add with the same id is refused and the log stays", async () => {
  await decided(werk, "auth", "Auth");
  await werk("add", "login", "--title", "First words", "--parent", "auth");
  const n = project().events().length;
  const again = await werk("add", "login", "--title", "Other words", "--parent", "auth");
  expect(again.code).not.toBe(0);
  expect(again.stderr).toContain("duplicate-id");
  expect(project().events().length).toBe(n);
  expect((await werk("show", "login")).stdout).toContain("First words");
});

test("05.3 a decided status is refused on add", async () => {
  await decided(werk, "auth", "Auth");
  const n = project().events().length;
  const r = await werk("add", "pay", "--title", "Pay", "--parent", "auth", "--status", "decided");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("decided");
  expect(r.stderr).toMatch(/not .*add|only through the status verb/);
  expect(project().events().length).toBe(n);
  const shown = await werk("show", "pay");
  expect(shown.stderr + shown.stdout).toMatch(/unknown card|not found/);
});

test("05.4 a hash sign on an id is optional, a title keeps its hash", async () => {
  await decided(werk, "auth", "Auth");
  const add = await werk("add", "#login", "--title", "#1 priority: magic links", "--parent", "#auth");
  expect(add.stdout.trim()).toBe("proposed");
  const a = await werk("show", "#login");
  const b = await werk("show", "login");
  expect(a.code).toBe(0);
  expect(a.stdout).toBe(b.stdout);
  expect(a.stdout).toMatch(/refines\s+auth/);
  expect(a.stdout).toContain("#1 priority: magic links");
});

test("05.5 a hand-written bad line is a problem and later cards still show", async () => {
  const lines = [
    { type: "node.proposed", id: "auth", kind: "card", title: "Auth", status: "open" },
    { type: "node.proposed", id: "bad", kind: "card", title: "Bad", status: "open", parent: "nowhere" },
    { type: "node.proposed", id: "login", kind: "card", title: "Login", status: "open", parent: "auth" },
  ];
  writeFileSync(project().logPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const raw = await Bun.file(project().logPath).text();
  const shown = await werk("show", "login");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("Login");
  expect(shown.stdout).toContain("proposed");
  // problems are listed by the show verb on stderr
  expect(shown.stderr).toContain("log line 2");
  expect(shown.stderr).toContain("unknown-card");
  expect(await Bun.file(project().logPath).text()).toBe(raw);
});
