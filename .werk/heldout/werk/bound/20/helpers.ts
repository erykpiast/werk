// Shared helpers of the held-out tests. They drive the real command line on a throw-away project.
import { resolve } from "node:path";
import { appendEvents } from "../src/map/log-store.ts";
import { type Project } from "../src/test-env/project.ts";

export const REPO = resolve(import.meta.dirname, "..");
export const CLI = resolve(REPO, "src", "cli.ts");

/** Runs one werk command in the project, through the real entry point. */
export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

export const all = (r: { stdout: string; stderr: string }) =>
  `${r.stdout}${r.stderr}`;

type Ev = Record<string, unknown>;

/** Appends Given-events through the same rule check that a write uses. A refused event is a binder error. */
export function seed(p: Project, ...events: (Ev | Ev[])[]): void {
  const result = appendEvents(p.logPath, events.flat());
  if (!result.ok) {
    throw new Error(
      `binder: seed refused: ${result.violation.rule}: ${result.violation.detail}`,
    );
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

const settle = (id: string): Ev[] => [
  { type: "node.edited", id, who: "me", noBasis: "held-out fixture" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

/** A real decided card. */
export const decided = (id: string, extra: Ev = {}): Ev[] => [
  ...real(id, extra),
  ...settle(id),
];

/** A ghost that was decided while it was a ghost. */
export const decidedGhost = (id: string, extra: Ev = {}): Ev[] => [
  ghost(id, extra),
  ...settle(id),
];

export const edge = (
  from: string,
  to: string,
  link = "depends_on",
  why = `${from} needs ${to}`,
): Ev => ({ type: "edge.added", from, to, link, why });

export const lines = (text: string): string[] =>
  text.split("\n").filter((line) => line.trim() !== "");
