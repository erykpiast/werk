// Shared helpers of the held-out tests. They use the product's own test harness.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export { freshProject, type Project };

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");

export type LogLine = { seq: number; at: string; actor: string; type: string; payload: Record<string, unknown> };

export const lines = (project: Project): LogLine[] =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

/** Append raw events to the log, as the map (the person's side) would write them. */
export function seed(project: Project, events: { type: string; actor?: string; payload: object }[]): void {
  const start = lines(project).at(-1)?.seq ?? 0;
  appendFileSync(
    logOf(project),
    events
      .map((event, i) => `${JSON.stringify({ seq: start + i + 1, at: "t", actor: event.actor ?? "you", ...event })}\n`)
      .join(""),
  );
}

/** A real card: a node.added event. */
export const real = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

/** A note the person types on a thread in the map. */
export const personNote = (project: Project, id: string, text: string) =>
  seed(project, [{ type: "note.added", actor: "you", payload: { id, text } }]);
