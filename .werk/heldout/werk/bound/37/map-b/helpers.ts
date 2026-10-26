import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export function seed(project: Project, ...events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export const werk = (project: Project, ...args: string[]) =>
  project.run(["bun", CLI, ...args]);

export function write(project: Project, path: string, text: string) {
  mkdirSync(dirname(join(project.dir, path)), { recursive: true });
  writeFileSync(join(project.dir, path), text);
}

export { createProject };
