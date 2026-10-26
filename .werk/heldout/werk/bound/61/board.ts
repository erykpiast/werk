import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI } from "./cli.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export type Board = {
  project: Project;
  werk: (...args: string[]) => ReturnType<Project["run"]>;
  boardPath: string;
  seed: (...events: unknown[]) => void;
  lines: () => string[];
  raw: () => string;
};

export function board(): Board {
  const project = createProject();
  const boardPath = join(project.dir, ".werk", "board.jsonl");
  return {
    project,
    boardPath,
    werk: (...args) => project.run(["bun", CLI, ...args]),
    seed(...events) {
      mkdirSync(dirname(boardPath), { recursive: true });
      writeFileSync(boardPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
    },
    lines: () => readFileSync(boardPath, "utf8").split("\n").filter(Boolean),
    raw: () => readFileSync(boardPath, "utf8"),
  };
}
