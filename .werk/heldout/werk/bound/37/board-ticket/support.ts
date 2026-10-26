import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export function useWerk() {
  let project: Project;
  beforeEach(() => {
    project = createProject();
  });
  afterEach(() => project.dispose());
  const api = {
    project: () => project,
    werk: (...args: string[]) => project.run(["bun", CLI, ...args]),
    boardPath: () => join(project.dir, ".werk", "board.jsonl"),
    seed: (...events: unknown[]) => {
      mkdirSync(join(project.dir, ".werk"), { recursive: true });
      writeFileSync(
        join(project.dir, ".werk", "board.jsonl"),
        events.map((e) => `${JSON.stringify(e)}\n`).join(""),
      );
    },
    boardText: () => readFileSync(join(project.dir, ".werk", "board.jsonl"), "utf8"),
    boardLines: () =>
      readFileSync(join(project.dir, ".werk", "board.jsonl"), "utf8")
        .trim()
        .split("\n"),
  };
  return api;
}
