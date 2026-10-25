import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const current = () => project;
const werk = (...args: string[]) => current().run(["bun", CLI, ...args]);

test("add under a parent appends one event, and show prints the card as proposed under it", async () => {
  expect((await werk("add", "root", "--title", "Root")).stdout.trim()).toBe(
    "proposed",
  );
  const added = await werk(
    "add",
    "child",
    "--title",
    "Child",
    "--why",
    "w",
    "--parent",
    "root",
  );
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(current().events()).toHaveLength(2);
  const shown = await werk("show", "child");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("proposed");
  expect(shown.stdout).toContain("-> refines");
  expect(shown.stdout).toContain("root");
});

test("a second add with the same id exits non-zero, names the rule, and appends nothing", async () => {
  await werk("add", "a", "--title", "A");
  const again = await werk("add", "a", "--title", "Other");
  expect(again.code).toBe(1);
  expect(again.stderr).toContain("duplicate-id");
  expect(current().events()).toHaveLength(1);
});

test("add with a decided status is refused", async () => {
  const result = await werk("add", "a", "--title", "A", "--status", "decided");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("decided");
  expect(current().events()).toHaveLength(0);
});

test("add refuses bad input before it writes", async () => {
  for (const args of [
    ["add"],
    ["add", "a"],
    ["add", "a", "--title", "A", "--nope", "x"],
    ["add", "a", "--title", "A", "--status", "x"],
  ]) {
    expect((await werk(...args)).code).toBe(2);
  }
  expect(
    (await werk("add", "a", "--title", "A", "--parent", "ghost")).stderr,
  ).toContain("unknown-card");
  expect(current().events()).toHaveLength(0);
});

test("show takes #id and id as the same card, and a title that starts with a hash keeps it", async () => {
  await werk(
    "add",
    "#hashed",
    "--title",
    "#hashed title",
    "--why",
    "see #other",
  );
  const plain = await werk("show", "hashed");
  const hashed = await werk("show", "#hashed");
  expect(hashed.stdout).toBe(plain.stdout);
  expect(plain.stdout).toContain("#hashed title");
  expect(plain.stdout).toContain("why: see #other");
  expect((current().events()[0] as { id: string }).id).toBe("hashed");
});

test("show names an unknown card and refuses a call with no id", async () => {
  expect((await werk("show", "nope")).code).toBe(1);
  expect((await werk("show")).code).toBe(2);
  expect((await werk("show", "--x", "1")).code).toBe(2);
});

test("a hand-written bad line is listed as a problem and the cards after it still show", async () => {
  await werk("add", "a", "--title", "A");
  const log = current().logPath;
  writeFileSync(
    log,
    `${readFileSync(log, "utf8")}{not json\n{"type":"node.proposed","id":"a","kind":"card","title":"dup","status":"open"}\n`,
  );
  await werk("add", "b", "--title", "B");
  const shown = await werk("show", "b");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("B");
  expect(shown.stderr).toContain("log line 2: bad-json");
  expect(shown.stderr).toContain("log line 3: duplicate-id");
});

test("help lists the registered verbs", async () => {
  const result = await werk("help");
  expect(result.stdout).toContain("add");
  expect(result.stdout).toContain("show");
  expect(result.stdout).toContain("help");
  expect((await werk("nope")).code).toBe(2);
});

test("link needs a reason for depends_on, refuses lineage, and appends nothing then", async () => {
  await werk("add", "a", "--title", "A");
  await werk("add", "a1", "--title", "A1", "--parent", "a");
  await werk("add", "b", "--title", "B");
  const before = current().events().length;
  const noWhy = await werk("link", "a1", "b", "--type", "depends_on");
  expect(noWhy.code).toBe(1);
  const lineage = await werk(
    "link",
    "a1",
    "a",
    "--type",
    "depends_on",
    "--why",
    "x",
  );
  expect(lineage.code).toBe(1);
  expect(lineage.stderr).toContain("ancestor");
  const option = await werk("add", "o", "--title", "O");
  expect(option.code).toBe(0);
  expect(current().events()).toHaveLength(before + 1);
});

test("linking the same pair again replaces the reason shown, and a link on a ghost shows as held", async () => {
  await werk("add", "a", "--title", "A");
  await werk("add", "b", "--title", "B");
  for (const why of ["first", "second"]) {
    const r = await werk(
      "link",
      "a",
      "b",
      "--type",
      "depends_on",
      "--why",
      why,
    );
    expect(r.stdout.trim()).toBe("linked");
  }
  const shown = (await werk("show", "a")).stdout;
  expect(shown).toContain("second");
  expect(shown).not.toContain("first");
  expect(shown).toContain("[held]");
  const gone = await werk("unlink", "a", "b", "--type", "depends_on");
  expect(gone.stdout.trim()).toBe("unlinked");
  expect((await werk("show", "a")).stdout).not.toContain("depends_on");
  expect((await werk("unlink", "a", "b", "--type", "depends_on")).code).toBe(1);
});

test("link and unlink reject a missing type or a wrong count of ids", async () => {
  expect((await werk("link", "a", "b")).code).toBe(2);
  expect((await werk("link", "a", "--type", "refines")).code).toBe(2);
  expect((await werk("unlink", "a", "b", "--why", "x")).code).toBe(2);
});
