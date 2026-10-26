import { resolve } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = resolve(import.meta.dirname, "..", "src", "cli.ts");
export { createProject, type Project };

/** Runs one werk command in the project. */
export function werk(p: Project, ...args: string[]) {
  return p.run(["bun", CLI, ...args]);
}

/** Runs werk and expects exit 0. */
export async function ok(p: Project, ...args: string[]) {
  const r = await werk(p, ...args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} failed (${r.code}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Adds a card and accepts it as the person. */
export async function decided(p: Project, id: string, title: string, parent?: string, extra: string[] = []) {
  await ok(p, "add", id, "--title", title, ...(parent ? ["--parent", parent] : []), ...extra);
  await ok(p, "accept", id, "--actor", "you");
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { shapeRead } from "../src/serve/read-api.ts";
import { decided as decidedEvents, ghost, link as linkEvent, open as openEvents } from "../src/map/mark-fixtures.ts";
export { decidedEvents, ghost, linkEvent, openEvents };

/** Appends events straight to the map log, as a fixture. */
export function seed(p: Project, ...events: unknown[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(p.logPath, `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`);
}

/** What the map shows: the shape that the server's graph route returns. */
export const shape = (p: Project) => shapeRead(readMap(p.logPath).map);
export const shownIds = (p: Project) => shape(p).nodes.map((n) => n.id);
export const mapOf = (p: Project) => readMap(p.logPath).map;
export const logLines = (p: Project) => (existsSync(p.logPath) ? readFileSync(p.logPath, "utf8").split("\n").filter(Boolean).length : 0);
export const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
