import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, open } from "../../src/map/mark-fixtures.ts";
import type { Project } from "../../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..", "..");
export const CLI = join(ROOT, "src", "cli.ts");

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Appends hand-written events to the map log, as a person editing the file would. */
export function writeLog(p: Project, ...events: unknown[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(
    p.logPath,
    events
      .flat()
      .map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`)
      .join(""),
  );
}

export { decided, ghost, open, writeFileSync };
