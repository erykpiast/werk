// Shared helpers of the held-out tests: a fresh project from the repository's own harness, a
// seeded log, and the command runner.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Seed = [type: string, payload: Payload];

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");
export const events = (project: Project) => lines(project).map((line) => JSON.parse(line));

/** A project whose log holds the given events, written as the person's accepted map. */
export function withMap(seeds: Seed[]): Project {
  const project = freshProject();
  seed(project, seeds);
  return project;
}

export function seed(project: Project, seeds: Seed[]): void {
  const start = lines(project).length;
  const text = seeds.map(([type, payload], i) =>
    JSON.stringify({ seq: start + i + 1, at: "2026-01-01T00:00:00.000Z", actor: "you", type, payload }),
  );
  if (text.length > 0) appendFileSync(logOf(project), `${text.join("\n")}\n`);
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const decided = (id: string): Seed => ["node.decided", { id }];
export const link = (from: string, to: string, type: string, why?: string): Seed => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export async function ok(project: Project, args: string[]): Promise<Run> {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

export { freshProject, type Project };
