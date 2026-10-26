import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fold, parseLog } from "../../src/map/fold.ts";
import type { Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

/** Writes the events as the project's log and fails my own test when any event is refused by the fold. */
export function writeLog(project: Project, events: unknown[]): void {
  const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
  writeFileSync(project.logPath, text);
  const map = fold(parseLog(text));
  if (map.problems.length > 0)
    throw new Error(`binder error, fixture refused: ${JSON.stringify(map.problems)}`);
}

export const werk = (project: Project, ...args: string[]) =>
  project.run(["bun", CLI, ...args]);

export const lines = (text: string) =>
  text.split("\n").filter((l) => l.trim() !== "");
