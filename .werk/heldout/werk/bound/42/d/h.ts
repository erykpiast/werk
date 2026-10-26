import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
export { createProject, type Project };

export function tools(project: Project) {
  const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
  const write = (path: string, text: string) => {
    mkdirSync(join(project.dir, path, ".."), { recursive: true });
    writeFileSync(join(project.dir, path), text);
  };
  const boardPath = join(project.dir, ".werk", "board.jsonl");
  const seedBoard = (...events: unknown[]) =>
    write(
      ".werk/board.jsonl",
      events.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
  const seedMap = (...events: unknown[]) =>
    write(
      ".werk/log.jsonl",
      events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
  const board = () => {
    try {
      return readFileSync(boardPath, "utf8");
    } catch {
      return "";
    }
  };
  return { werk, write, boardPath, seedBoard, seedMap, board };
}
