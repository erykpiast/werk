import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";
import { ticket } from "../tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const check = (...extra: string[]) =>
  werk(
    "ticket-check",
    "tickets",
    "--root",
    "root",
    "--spec",
    "spec.md",
    ...extra,
  );

async function seedMap() {
  await werk("add", "root", "--title", "Root", "--status", "open");
  await werk("accept", "root", "--actor", "you");
}

test("a folder of correct tickets exits 0 with a count line", async () => {
  write(".werk/log.jsonl", "");
  await seedMap();
  write("spec.md", "## User stories\n\n1. As a person, I want a.\n");
  write("tickets/01-a.md", ticket({ cites: "" }));
  const result = await check();
  expect(result.stdout.trim()).toContain("0 failures");
  expect(result.code).toBe(0);
});

test("a failing ticket exits 1 with one line per failure", async () => {
  await seedMap();
  write("spec.md", "## User stories\n\n1. a\n");
  write(
    "tickets/01-a.md",
    ticket({ what: "Edit src/loop.ts.", touches: null }),
  );
  const result = await check();
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("01-a.md: shape: touches: ");
  expect(result.stdout).toContain("src/loop.ts (line 8)");
});

test("a spec with no User stories heading exits 2", async () => {
  await seedMap();
  write("spec.md", "# Spec\n");
  mkdirSync(join(project.dir, "tickets"), { recursive: true });
  const result = await check();
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("User stories");
});

test("a malformed call exits 2", async () => {
  await seedMap();
  write("spec.md", "## User stories\n");
  expect((await werk("ticket-check", "tickets")).code).toBe(2);
  expect((await werk("ticket-check", "--bogus", "x")).code).toBe(2);
  expect((await check()).code).toBe(2); // no folder
  mkdirSync(join(project.dir, "tickets"));
  expect(
    (
      await werk(
        "ticket-check",
        "tickets",
        "--root",
        "nope",
        "--spec",
        "spec.md",
      )
    ).code,
  ).toBe(2);
  expect(
    (
      await werk(
        "ticket-check",
        "tickets",
        "--root",
        "root",
        "--spec",
        "gone.md",
      )
    ).code,
  ).toBe(2);
});
