// Held-out test helpers: a fresh project from the project's own harness, a seed of Given events,
// and reads of the decision log.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Held = Project & {
  log: string;
  seed(type: string, payload: object, actor?: string): void;
  events(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  w(...args: string[]): ReturnType<Project["werk"]>;
};

export function held(): Held {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const events = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(
      log,
      `${JSON.stringify({ seq: events().length + 1, at: "2026-01-01T00:00:00.000Z", actor, type, payload })}\n`,
    );
  return Object.assign(p, { log, seed, events, w: (...args: string[]) => p.werk(args) });
}

/** A real card, optionally decided. */
export function card(h: Held, id: string, title: string, extra: Record<string, unknown> = {}, decided = false): void {
  h.seed("node.added", { id, kind: "card", title, ...extra });
  if (decided) h.seed("node.decided", { id });
}
