/** Helpers for the held-out tests: a fresh project, the werk command line, and map events. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const REPO = resolve(import.meta.dirname, "..");
export const CLI = join(REPO, "src", "cli.ts");

export type Ev = Record<string, unknown>;

export function newProject(): Project {
  return createProject();
}

export function werkIn(project: Project) {
  return (...args: string[]) => project.run(["bun", CLI, ...args]);
}

export function seedLog(project: Project, ...events: (Ev | Ev[])[]): void {
  mkdirSync(dirname(project.logPath), { recursive: true });
  writeFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
}

export function logLines(project: Project): string[] {
  try {
    return readFileSync(project.logPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export const ghost = (id: string, extra: Ev = {}): Ev => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});

/** A real card: proposed, then accepted by the person. */
export const real = (id: string, extra: Ev = {}): Ev[] => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];

/** A real decided card, with the contract facts waived. */
export const decided = (id: string, extra: Ev = {}): Ev[] => [
  ...real(id, extra),
  { type: "node.edited", id, who: "me", noBasis: "test" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

export const link = (from: string, to: string, type = "depends_on"): Ev => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why: `${from} takes ${to}`,
});

/** Board events: a finished ticket needs a plan, a move to building, to merging and the merge. */
export const doneTicket = (id: string): Ev[] => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
