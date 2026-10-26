import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export type Tools = {
  project: Project;
  /** Runs one werk command in the project. */
  werk: (...args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Appends events to the map log, as lines. */
  seed: (...events: unknown[]) => void;
  /** Appends events to the board log. */
  seedBoard: (...events: unknown[]) => void;
  /** The number of lines in the map log. */
  logLines: () => number;
};

export function tools(project: Project): Tools {
  const append = (path: string, events: unknown[]) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
  };
  return {
    project,
    werk: (...args) => project.run(["bun", CLI, ...args]),
    seed: (...events) => append(project.logPath, events),
    seedBoard: (...events) => append(join(project.dir, ".werk", "board.jsonl"), events),
    logLines: () => project.events().length,
  };
}

/** A fresh project and its tools for each test of the file. */
export function useTools(): () => Tools {
  let current: Project | undefined;
  beforeEach(() => {
    current = createProject();
  });
  afterEach(async () => {
    await current?.dispose();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error("no project outside a test");
    return tools(current);
  };
}
