import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, open } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export { decided, ghost, open };

export type World = {
  project: Project;
  werk: (...args: string[]) => ReturnType<Project["run"]>;
  seed: (...events: unknown[]) => void;
  events: () => unknown[];
  logLines: () => number;
  chat: (name: string, ...lines: unknown[]) => void;
};

export function world(): World {
  const project = createProject();
  const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
  const seed = (...events: unknown[]) => {
    mkdirSync(join(project.dir, ".werk"), { recursive: true });
    writeFileSync(
      project.logPath,
      events
        .flat()
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(""),
    );
  };
  const logLines = () => {
    try {
      return readFileSync(project.logPath, "utf8").split("\n").filter(Boolean)
        .length;
    } catch {
      return 0;
    }
  };
  const chat = (name: string, ...lines: unknown[]) => {
    const dir = join(project.dir, ".werk", "chats");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${name}.jsonl`),
      lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    );
  };
  return { project, werk, seed, events: () => project.events(), logLines, chat };
}

export const child = (id: string, parent: string, extra: Record<string, unknown> = {}) =>
  open(id, { parent, ...extra });
export const decidedChild = (id: string, parent: string, extra: Record<string, unknown> = {}) =>
  decided(id, { parent, ...extra });
export { link, reopen } from "../src/map/mark-fixtures.ts";
