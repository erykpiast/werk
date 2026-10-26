import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
export const YOU = ["--actor", "you"];
export const SLOW = 90_000;

export function make() {
  const project: Project = createProject();
  const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
  /** A real card accepted by the person. */
  const card = async (id: string, parent?: string, extra: string[] = []) => {
    const a = await werk(
      "add",
      id,
      "--title",
      id,
      ...(parent ? ["--parent", parent] : []),
      ...extra,
    );
    const b = await werk("accept", id, ...YOU);
    return { a, b };
  };
  return { project, werk, card };
}

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Writes events into the log by hand, one JSON object per line. */
export function seed(project: Project, ...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  appendFileSync(
    project.logPath,
    `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
}
