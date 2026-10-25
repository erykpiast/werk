import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { open } from "../map/mark-fixtures.ts";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
  const events = [
    ...open("top", { title: "Seat price" }),
    ...open("kid", { parent: "top", title: "Seat plan", status: "proto" }),
    { type: "node.edited", id: "top", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "top", form: "revisit" },
    { type: "node.decided", id: "top" },
  ];
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);

test("find lists a proto card and search prints the decided index", async () => {
  const found = await werk("find", "top");
  expect(found.code).toBe(0);
  expect(found.stdout.trim()).toBe("kid  [proto]  Seat plan");
  const index = await werk("search");
  expect(index.stdout.trim()).toBe("top  Seat price");
  const matches = await werk("search", "seat", "PLAN");
  expect(matches.stdout.trim()).toBe("kid  [proto]  Seat plan");
});

test("bad arguments exit 2 and an unknown card exits 1", async () => {
  expect((await werk("find", "a", "b")).code).toBe(2);
  expect((await werk("find", "none")).code).toBe(1);
  expect((await werk("search", "--status", "red")).code).toBe(2);
  expect((await werk("search", "--under", "none")).code).toBe(1);
});

test("an empty term is no term and the search returns", async () => {
  const empty = await werk("search", "");
  expect(empty.code).toBe(0);
  expect(empty.stdout.trim()).toBe("top  Seat price");
});
