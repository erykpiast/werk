import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export const YOU = ["--actor", "you"];
export const SLOW = 90_000;

export { createProject, type Project };

export function cli(project: Project) {
  return (...args: string[]) => project.run(["bun", CLI, ...args]);
}

/** Replaces the map log with the given events, one per line. */
export function seedLog(project: Project, ...events: unknown[]) {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`)
      .join(""),
  );
}

export function boardPath(project: Project) {
  return join(project.dir, ".werk", "board.jsonl");
}

export function seedBoard(project: Project, ...events: unknown[]) {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    boardPath(project),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const boardLines = (project: Project) =>
  readFileSync(boardPath(project), "utf8").trim().split("\n");

export const rawLog = (project: Project) => readFileSync(project.logPath, "utf8");
