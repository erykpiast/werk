import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");
export const YOU = ["--actor", "you"];
export const SLOW = 90_000;

export { createProject, type Project };

export const werkIn =
  (project: Project) =>
  (...args: string[]) =>
    project.run(["bun", CLI, ...args]);

export function seedMap(project: Project, events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((event) => `${JSON.stringify(event)}\n`)
      .join(""),
  );
}

export const boardPath = (project: Project) =>
  join(project.dir, ".werk", "board.jsonl");

export function seedBoard(project: Project, events: unknown[]) {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    boardPath(project),
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
}

export const boardText = (project: Project) =>
  readFileSync(boardPath(project), "utf8");

export const planned = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id,
  title: `Ticket ${id}`,
  ...extra,
});
