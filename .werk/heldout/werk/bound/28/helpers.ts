import { test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export type Ctx = {
  project: () => Project;
  werk: (...args: string[]) => ReturnType<Project["run"]>;
  seed: (...events: unknown[]) => void;
  seedBoard: (...events: unknown[]) => void;
  mapLog: () => string;
  boardLog: () => string;
  eventCount: () => number;
};

export function makeCtx(): Ctx & { dispose: () => Promise<void> } {
  const project = createProject();
  const p = () => project;
  const write = (path: string, events: unknown[]) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
  };
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  return {
    project: p,
    werk: (...args) => p().run(["bun", CLI, ...args]),
    seed: (...events) => write(p().logPath, events),
    seedBoard: (...events) => write(join(p().dir, ".werk", "board.jsonl"), events),
    mapLog: () => read(p().logPath),
    boardLog: () => read(join(p().dir, ".werk", "board.jsonl")),
    eventCount: () => p().events().length,
    dispose: () => project.dispose(),
  };
}

/** A test that gets its own fresh project, removed when the test ends. */
export function t(name: string, fn: (ctx: Ctx) => Promise<void> | void, ms = 120000) {
  test(
    name,
    async () => {
      const ctx = makeCtx();
      try {
        await fn(ctx);
      } finally {
        await ctx.dispose();
      }
    },
    ms,
  );
}
