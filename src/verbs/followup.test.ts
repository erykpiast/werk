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
const done = [
  { type: "ticket.planned", id: "r/01" },
  { type: "ticket.moved", id: "r/01", to: "building" },
  { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
  { type: "ticket.merge", id: "r/01" },
];
const plan = ["--class", "plan", "--found", "review", "--why", "silent card"];

test("a build miss without the catchable answer is refused and appends nothing", async () => {
  seed(...done);
  const result = await werk(
    "followup",
    "1",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "x",
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("catchable");
  expect(lines()).toHaveLength(done.length);
});

test("a plan miss refuses the catchable answer", async () => {
  seed(...done);
  const result = await werk("followup", "1", ...plan, "--catchable", "yes");
  expect(result.code).toBe(1);
  expect(lines()).toHaveLength(done.length);
});

test("a record on a ticket in building is refused and appends nothing", async () => {
  seed(done[0], done[1]);
  const result = await werk("followup", "r/01", ...plan);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("not done");
  expect(lines()).toHaveLength(2);
});

test("a ticket that does not exist is refused", async () => {
  seed(...done);
  expect((await werk("followup", "7", ...plan)).code).toBe(1);
  expect(lines()).toHaveLength(done.length);
});

test("a record is appended, and a correction of record 1 shows as the class in force", async () => {
  seed(...done);
  const first = await werk(
    "followup",
    "1",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "link lasts 1 minute",
    "--catchable",
    "yes",
  );
  expect(first.code).toBe(0);
  expect(first.stdout.trim()).toBe("recorded");
  expect(JSON.parse(lines().at(-1) as string)).toMatchObject({
    type: "ticket.followup_recorded",
    id: "r/01",
    class: "build",
    catchable: true,
  });
  const fix = await werk("followup", "1", ...plan, "--of", "1");
  expect(fix.code).toBe(0);
  const list = await werk("followup", "1", "--list");
  expect(list.code).toBe(0);
  expect(list.stdout.trim().split("\n")).toEqual([
    "1. corrected by 2, in force: plan miss, found review - silent card",
    "2. correction of 1: plan miss, found review - silent card",
  ]);
});

test("bad input exits 2 before the board is read", async () => {
  for (const args of [
    ["followup"],
    ["followup", "1"],
    ["followup", "1", "--list", "--why", "x"],
    ["followup", "1", ...plan, "--catchable", "maybe"],
    ["followup", "1", ...plan, "--of", "x"],
    ["followup", "1", "--nope", "x"],
  ])
    expect((await werk(...args)).code).toBe(2);
});
