import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    boardPath(),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
};
const lines = () => readFileSync(boardPath(), "utf8").trim().split("\n");

test("restore appends one restore event and ends the archive", async () => {
  seed(
    { type: "ticket.planned", id: "r/01", reason: "waits" },
    { type: "ticket.archived", id: "r/01" },
  );
  const result = await werk("ticket", "restore", "1", "--actor", "you");
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe("restored");
  expect(lines()).toHaveLength(3);
  expect(JSON.parse(lines()[2] as string)).toEqual({
    type: "ticket.restored",
    ticket: "r/01",
    actor: "you",
  });
});

test("restore of a ticket that is not archived exits 1 and appends nothing", async () => {
  seed({ type: "ticket.planned", id: "r/01" });
  const result = await werk("ticket", "restore", "01");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("not-archived");
  expect(lines()).toHaveLength(1);
});

test("restore of a number not on the board exits 1 and appends nothing", async () => {
  seed({ type: "ticket.planned", id: "r/01" });
  const result = await werk("ticket", "restore", "07");
  expect(result.code).toBe(1);
  expect(lines()).toHaveLength(1);
});

test("restore on a project with no board log exits 1", async () => {
  expect((await werk("ticket", "restore", "01")).code).toBe(1);
});

test("restore refuses bad input before it reads the board", async () => {
  for (const args of [
    ["ticket"],
    ["ticket", "list"],
    ["ticket", "restore"],
    ["ticket", "restore", "1", "2"],
    ["ticket", "restore", "1", "--actor", "robot"],
    ["ticket", "restore", "1", "--nope", "x"],
  ]) {
    expect((await werk(...args)).code).toBe(2);
  }
});
