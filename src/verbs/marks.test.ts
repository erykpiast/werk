import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { link, open } from "../map/mark-fixtures.ts";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

/** Writes the events that make each card and decide it, straight into the log. */
function decided(...cards: [id: string, ...links: string[]][]) {
  const events = cards.flatMap(([id, ...links]) => [
    ...open(id),
    ...links.map((to) => link(id, to)),
    { type: "node.edited", id, who: "me", noBasis: "test" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  ]);
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
}

test("stale exits 0 and says so when nothing is marked", async () => {
  decided(["x"]);
  const result = await werk("stale");
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe("nothing is marked");
});

test("a reopen with no reason marks the dependent, and show and stale print the trace", async () => {
  decided(["x"], ["y", "x"], ["z", "y"]);
  const reopened = await werk(
    "reopen",
    "x",
    "--why",
    "Charging moves to usage.",
  );
  expect(reopened.code).toBe(0);
  const shown = await werk("show", "y");
  expect(shown.stdout).toContain("STALE from #x, invalidated on");
  expect(shown.stdout).toContain("Charging moves to usage.");
  expect(shown.stdout).toContain("y -> x: y takes x");
  expect((await werk("show", "z")).stdout).not.toContain("STALE");
  const list = await werk("stale", "--kind", "stale");
  expect(list.stdout).toContain("stale    y");
  expect(list.stdout).not.toContain(" z ");
});

test("a confirm on a stale basis is refused with the fixing command", async () => {
  decided(["x"], ["y", "x"]);
  await werk("reopen", "x");
  const refused = await werk("rederive", "y", "--confirm", "x");
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("werk status x decided");
  await werk("status", "x", "decided");
  const skipped = await werk("rederive", "y");
  expect(skipped.code).toBe(1);
  expect(skipped.stderr).toContain("werk rederive y --confirm x");
  const done = await werk(
    "rederive",
    "y",
    "--confirm",
    "all",
    "--status",
    "decided",
  );
  expect(done.code).toBe(0);
  expect((await werk("stale")).stdout.trim()).toBe("nothing is marked");
});

test("an amend marks the next hop with the review sentence", async () => {
  decided(["x"], ["y", "x"], ["z", "y"]);
  await werk("reopen", "x");
  const amended = await werk(
    "rederive",
    "y",
    "--amend",
    "The invoice now shows usage units.",
  );
  expect(amended.code).toBe(0);
  const shown = await werk("show", "z");
  expect(shown.stdout).toContain("STALE from #y, amended on");
  expect(shown.stdout).toContain("The invoice now shows usage units.");
});

test("a postponement pauses downstream and a decide resumes", async () => {
  decided(["p"], ["q", "p"]);
  await werk("reopen", "p", "--reason", "postponed");
  const list = await werk("stale", "p", "--kind", "paused");
  expect(list.stdout).toContain("paused   p");
  expect((await werk("stale", "--kind", "paused")).stdout).toContain(
    "paused   q",
  );
  await werk("status", "p", "decided");
  expect((await werk("stale")).stdout.trim()).toBe("nothing is marked");
});

test("bad arguments exit 2 and a refused write exits 1", async () => {
  decided(["x"]);
  expect((await werk("reopen", "x", "--reason", "later")).code).toBe(2);
  expect((await werk("reopen")).code).toBe(2);
  expect((await werk("reopen", "none")).code).toBe(1);
  expect((await werk("stale", "--kind", "red")).code).toBe(2);
  expect((await werk("stale", "a", "b")).code).toBe(2);
  expect((await werk("stale", "none")).code).toBe(1);
  expect((await werk("rederive")).code).toBe(2);
  expect((await werk("rederive", "x", "--status", "open")).code).toBe(2);
  expect(
    (await werk("rederive", "x", "--amend", "a", "--confirm", "b")).code,
  ).toBe(2);
  expect((await werk("rederive", "none")).code).toBe(1);
  expect((await werk("rederive", "x")).code).toBe(1);
  expect((await werk("rederive", "x", "--status", "decided")).stdout).toContain(
    "holds",
  );
});
