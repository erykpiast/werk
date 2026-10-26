import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export function harness() {
  let project: Project;
  return {
    create() {
      project = createProject();
      return project;
    },
    dispose: () => project.dispose(),
    get project() {
      return project;
    },
    werk: (...args: string[]) => project.run(["bun", CLI, ...args]),
    boardPath: () => join(project.dir, ".werk", "board.jsonl"),
    seedBoard(...events: unknown[]) {
      mkdirSync(join(project.dir, ".werk"), { recursive: true });
      writeFileSync(
        join(project.dir, ".werk", "board.jsonl"),
        events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
    },
    seedMap(...events: unknown[]) {
      writeFileSync(
        project.logPath,
        events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
    },
    boardText: () =>
      readFileSync(join(project.dir, ".werk", "board.jsonl"), "utf8"),
    boardLines: () =>
      readFileSync(join(project.dir, ".werk", "board.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l)),
    write(path: string, text: string) {
      mkdirSync(join(project.dir, path, ".."), { recursive: true });
      writeFileSync(join(project.dir, path), text);
    },
  };
}
