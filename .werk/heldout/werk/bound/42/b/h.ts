import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMap } from "../../src/map/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

export { decided, ghost, link, open, reopen } from "../../src/map/mark-fixtures.ts";
export { createProject, type Project };

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export function mk(events: unknown[] = []) {
  const project = createProject();
  seed(project, events);
  const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
  return { project, werk };
}

export function seed(project: Project, events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.flat().map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`).join(""),
  );
}

export const lines = (project: Project) =>
  readFileSync(project.logPath, "utf8").split("\n").filter(Boolean);

export const mapOf = (project: Project) => readMap(project.logPath).map;
