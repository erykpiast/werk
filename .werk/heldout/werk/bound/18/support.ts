/** Helpers for the held-out tests: seed a map log with events, and run werk verbs. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export * from "./events.ts";

export function seed(project: Project, ...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  const flat = events.flat();
  writeFileSync(
    project.logPath,
    flat.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  // Guard: a setup that the fold refuses is my error, not the product's.
  const text = flat.map((e) => JSON.stringify(e)).join("\n");
  const map = fold(parseLog(text));
  if (map.problems.length > 0) {
    throw new Error(
      `binder setup refused by fold: ${JSON.stringify(map.problems)}`,
    );
  }
  return map;
}

export function werkOf(project: Project) {
  return (...args: string[]) => project.run(["bun", CLI, ...args]);
}

export { createProject, type Project };
