/** Shared helpers of the held-out CLI tests. Map events come from the product's own fixture builders. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide as decideEvent, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export { createProject, link };
export type { Project };

/** Runs one werk command in the project. */
export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Writes events as the whole map log of the project. */
export function writeLog(p: Project, events: unknown[]): void {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(p.logPath, `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`);
}

/** A real open card: proposed, then accepted. */
export const real = (id: string, extra: Record<string, unknown> = {}) =>
  open(id, { title: extra.title ?? `Title ${id}`, ...extra });

/** Waives the facts the test does not care about and decides the card. */
export const settle = (id: string) => [
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  decideEvent(id),
];

/** A real card that is decided. A parent must be decided first. */
export const decidedCard = (id: string, extra: Record<string, unknown> = {}) => [
  ...real(id, extra),
  ...settle(id),
];

export { ghost, open };

export const chatLog = (p: Project, name: string, ...lines: unknown[]) => {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
};

export const lines = (text: string) =>
  text.split("\n").filter((l) => l.trim() !== "");
