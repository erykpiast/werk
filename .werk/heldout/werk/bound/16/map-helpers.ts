// Shared helpers of the held-out map tests: a fresh project with a seeded log, and werk runs on it.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type MapProject = {
  p: Project;
  log: string;
  lines(): string[];
  events(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  seed(type: string, payload: object, actor?: string): void;
  w(...args: string[]): Promise<Run>;
  ok(...args: string[]): Promise<Run>;
};

export function mapProject(): MapProject {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const lines = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  const events = () => lines().map((line) => JSON.parse(line));
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(
      log,
      `${JSON.stringify({ seq: lines().length + 1, at: "2026-01-01T00:00:00.000Z", actor, type, payload })}\n`,
    );
  const w = (...args: string[]) => p.werk(args);
  const ok = async (...args: string[]) => {
    const run = await p.werk(args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
    return run;
  };
  return { p, log, lines, events, seed, w, ok };
}

/** The first line of a show: the kind, the id, the status and the marks. */
export const head = (out: string) => out.split("\n")[0] ?? "";
/** A show prints a ghost with "proposed" on its first line. */
export const isGhost = (out: string) => /\bproposed\b/.test(head(out));
/** The link lines of a show. */
export const linkLines = (out: string) => out.split("\n").filter((line) => /^\s+(->|<-)\s/.test(line));
