import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Writes the map log directly: the only way to make a decided card in this checkout. */
export function seedLog(p: Project, events: Record<string, unknown>[]) {
  mkdirSync(dirname(p.logPath), { recursive: true });
  writeFileSync(p.logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

export const card = (
  id: string,
  title: string,
  status: "open" | "proto" | "decided",
  extra: Record<string, unknown> = {},
) => [
  { type: "node.proposed", id, kind: "card", title, status, ...extra },
  { type: "node.accepted", id, actor: "you" },
];

export function write(p: Project, path: string, text: string) {
  const full = join(p.dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}
