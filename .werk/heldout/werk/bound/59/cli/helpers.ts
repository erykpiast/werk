import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export function makeProject(): Project {
  return createProject();
}

export const werkIn = (p: Project) => (...args: string[]) =>
  p.run(["bun", CLI, ...args]);

export function writeLines(path: string, events: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

export function appendLines(path: string, events: unknown[]): void {
  const prev = (() => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  })();
  writeFileSync(path, prev + events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});

/** A real card: proposed then accepted by a person. */
export const real = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];

/** A decided card (waives basis/criterion facts). */
export const decided = (id: string, extra: Record<string, unknown> = {}) => [
  ...real(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
