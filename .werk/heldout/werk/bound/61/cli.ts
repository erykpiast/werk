import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Project, createProject } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

export { decided, ghost, link, open, reopen } from "../src/map/mark-fixtures.ts";

export type Cli = {
  project: Project;
  werk: (...args: string[]) => ReturnType<Project["run"]>;
  write: (events: unknown[]) => void;
  append: (...lines: (unknown | string)[]) => void;
  events: () => unknown[];
  dispose: () => Promise<void>;
};

export function cli(): Cli {
  const project = createProject();
  const text = (events: unknown[]) =>
    events.map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`).join("");
  return {
    project,
    werk: (...args) => project.run(["bun", CLI, ...args]),
    write(events) {
      mkdirSync(dirname(project.logPath), { recursive: true });
      writeFileSync(project.logPath, text(events));
    },
    append(...lines) {
      writeFileSync(project.logPath, readFileSync(project.logPath, "utf8") + text(lines));
    },
    events: () => project.events(),
    dispose: () => project.dispose(),
  };
}
