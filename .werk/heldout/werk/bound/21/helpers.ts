import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decided, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export { decided, ghost, link, open };
export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export function werkIn(project: Project) {
  return (...args: string[]) => project.run(["bun", CLI, ...args]);
}

export function writeLog(project: Project, events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const refines = (from: string, to: string) =>
  link(from, to, "refines");

export { createProject };
export type { Project };
