/** Helpers for the held-out tests: a temporary project, the werk command line, and log seeding. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export { createProject };
export type { Project };

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

export function seedMap(p: Project, ...events: unknown[]) {
  mkdirSync(dirname(p.logPath), { recursive: true });
  writeFileSync(
    p.logPath,
    events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export function seedBoard(p: Project, ...events: unknown[]) {
  const path = join(p.dir, ".werk", "board.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const logLines = (p: Project) =>
  existsSync(p.logPath)
    ? readFileSync(p.logPath, "utf8").split("\n").filter(Boolean)
    : [];

export { ghost, open, decided, link } from "../src/map/mark-fixtures.ts";

export { copyRepo } from "./copy-repo.ts";
