/** Helpers for the held-out CLI tests: a throwaway project, a seeded map log and the werk command. */
import { afterEach, beforeEach, expect } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMap } from "../../src/map/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
import { ghost as ghostEvent } from "../../src/map/mark-fixtures.ts";
export { decided, ghost, link, open, reopen } from "../../src/map/mark-fixtures.ts";

/** A real card with status decided, written straight into the log. It skips the contract, so its parent may be open. */
export const decidedRaw = (id: string, extra: Record<string, unknown> = {}) => [
  ghostEvent(id, { ...extra, status: "decided" }),
  { type: "node.accepted", id, actor: "you" },
];

export type Ctx = { project: Project; werk: (...args: string[]) => ReturnType<Project["run"]> };

/** Makes one project per test and removes it after the test. */
export function useProject(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.project = createProject();
    ctx.werk = (...args) => ctx.project.run(["bun", CLI, ...args]);
  });
  afterEach(() => ctx.project.dispose());
  return ctx;
}

/** Appends events to the map log and checks that the fold applied every one of them. */
export function seed(project: Project, ...events: unknown[]): void {
  mkdirSync(dirname(project.logPath), { recursive: true });
  appendFileSync(
    project.logPath,
    events
      .flat(Infinity)
      .map((event) => `${JSON.stringify(event)}\n`)
      .join(""),
  );
  expect(readMap(project.logPath).map.problems).toEqual([]);
}

export const logLines = (project: Project): number =>
  readFileSync(project.logPath, "utf8").split("\n").filter(Boolean).length;
