// Shared helpers of the held-out tests: a fresh project from the product's own harness, a seeded
// log, and readers of the log file.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Seed = [string, Record<string, unknown>];

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");

export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

export const events = (project: Project) => lines(project).map((line) => JSON.parse(line));

/** Append events as the person wrote them, before the test's own steps. */
export function seed(project: Project, seeds: Seed[]): void {
  for (const [type, payload] of seeds) {
    const seq = lines(project).length + 1;
    appendFileSync(logOf(project), `${JSON.stringify({ seq, at: "t", actor: "you", type, payload })}\n`);
  }
}

export function seeded(seeds: Seed[]): Project {
  const project = freshProject();
  seed(project, seeds);
  return project;
}

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

export const card = (id: string, title: string, extra: Record<string, unknown> = {}): Seed => [
  "node.added",
  { id, kind: "card", title, ...extra },
];
