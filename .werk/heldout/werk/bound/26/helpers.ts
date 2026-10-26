import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export function runner(project: Project) {
  return (...args: string[]) => project.run(["bun", CLI, ...args]);
}

export { createProject };
export type { Project };

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { decided, open } from "../src/map/mark-fixtures.ts";

/** Appends events to the project's map log, as an earlier session of the product would have. */
export function seed(project: Project, ...events: unknown[]) {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  appendFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

/** A decided card under a parent (refines). */
export const dec = (id: string, parent?: string, extra: Record<string, unknown> = {}) =>
  decided(id, { title: id, ...(parent ? { parent } : {}), ...extra });
export const opn = (id: string, parent?: string, extra: Record<string, unknown> = {}) =>
  open(id, { title: id, ...(parent ? { parent } : {}), ...extra });

export function write(project: Project, path: string, text: string) {
  const full = join(project.dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

/** Shows the map as the person sees it: the ids of the cards in the folded log. */
export async function shownIds(project: Project): Promise<string[]> {
  const { readMap } = await import("../src/map/log-store.ts");
  return [...readMap(project.logPath).map.nodes.keys()];
}
export const link = (from: string, to: string, type = "depends_on") => ({
  type: "edge.added", from, to, link: type, why: `${from} takes ${to}`,
});
