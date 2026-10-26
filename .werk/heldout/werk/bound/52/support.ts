/** Helpers for the held-out tests: a project, a way to seed its logs, and a way to run werk. */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import { foldBoard } from "../src/board/fold.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { build, decided, ghost, link, open } from "../src/map/mark-fixtures.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");
export { createProject, decided, ghost, link, open, build };
export type { Project };

export function seed(project: Project, ...events: unknown[]): void {
  mkdirSync(dirname(project.logPath), { recursive: true });
  appendFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export function boardPath(project: Project): string {
  return join(dirname(project.logPath), "board.jsonl");
}

export function seedBoard(project: Project, ...events: unknown[]): void {
  appendFileSync(
    boardPath(project),
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export function boardText(project: Project): string {
  return existsSync(boardPath(project)) ? readFileSync(boardPath(project), "utf8") : "";
}

export function board(project: Project) {
  return foldBoard(parseLog(boardText(project)));
}

export function map(project: Project) {
  return fold(parseLog(existsSync(project.logPath) ? readFileSync(project.logPath, "utf8") : ""));
}

export const werk = (project: Project, ...args: string[]) =>
  project.run(["bun", CLI, ...args]);

/** A card the person accepted, with its own words, and a parent when given. */
export const card = (id: string, extra: Record<string, unknown> = {}) => open(id, extra);
