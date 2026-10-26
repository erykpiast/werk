import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export const werk = (project: Project, ...args: string[]) =>
  project.run(["bun", CLI, ...args]);

export function seedMap(project: Project, ...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export const boardPath = (project: Project) =>
  join(project.dir, ".werk", "board.jsonl");

export function seedBoard(project: Project, ...events: unknown[]) {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    boardPath(project),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const boardText = (project: Project) =>
  readFileSync(boardPath(project), "utf8");
