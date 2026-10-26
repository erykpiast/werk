// Shared helper for the held-out CLI tests: a fresh temporary project (removed by the run's preload
// after each test), a seed that appends raw events, and readers of the log.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Run } from "../src/test/project.ts";

export type P = ReturnType<typeof make>;

export function make() {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const events = () => lines().map((l) => JSON.parse(l));
  const seed = (type: string, payload: object) =>
    appendFileSync(
      log,
      `${JSON.stringify({ seq: lines().length + 1, at: "2026-10-01T00:00:00.000Z", actor: "you", type, payload })}\n`,
    );
  /** A real card. */
  const card = (id: string, fields: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title: id, ...fields });
  const w = (...args: string[]): Promise<Run> => p.werk(args);
  return { ...p, log, lines, events, seed, card, w };
}
