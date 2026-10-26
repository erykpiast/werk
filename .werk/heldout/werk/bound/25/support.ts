/** Shared helpers for the held-out tests. Uses werk's own test harness; changes nothing outside .werk-heldout/. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CHECKOUT = join(import.meta.dir, "..");
export const CLI = join(CHECKOUT, "src", "cli.ts");

export { createProject, type Project };

export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
export const open = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];
export const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...open(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const link = (from: string, to: string, type = "depends_on", why?: string) => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why: why ?? `${from} takes ${to}`,
});

export function seed(project: Project, events: unknown[]) {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
  // A seed that folds with a problem is my error, not the product's.
  const { map } = readMap(project.logPath);
  if (map.problems.length > 0)
    throw new Error(`seed has problems: ${JSON.stringify(map.problems)}`);
}
export const logText = (project: Project) => {
  try {
    return readFileSync(project.logPath, "utf8");
  } catch {
    return "";
  }
};
export const werkIn = (project: Project) => (...args: string[]) =>
  project.run(["bun", CLI, ...args]);

export function seedBoard(project: Project, events: unknown[]) {
  const path = join(dirname(project.logPath), "board.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}
export const lines = (text: string) =>
  text.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
