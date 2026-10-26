import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Appends raw events to the map log, as a fixture. */
export function put(p: Project, ...events: unknown[]): void {
  mkdirSync(dirname(p.logPath), { recursive: true });
  appendFileSync(
    p.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export const ghost = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title,
  status: "open",
  ...extra,
});

/** A real open card. */
export const real = (id: string, title: string, extra: Record<string, unknown> = {}) => [
  ghost(id, title, extra),
  { type: "node.accepted", id, actor: "you" },
];

/** A real decided card. */
export const decided = (id: string, title: string, extra: Record<string, unknown> = {}) => [
  ...real(id, title, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

export const edge = (from: string, to: string, link: string, why = "because") => ({
  type: "edge.added",
  from,
  to,
  link,
  why,
});

export const logText = (p: Project) => {
  try {
    return readFileSync(p.logPath, "utf8");
  } catch {
    return "";
  }
};

export function chat(p: Project, name: string, ...lines: unknown[]) {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
