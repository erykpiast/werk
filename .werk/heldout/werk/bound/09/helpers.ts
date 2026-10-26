// Shared helpers for the held-out command-line tests: a fresh project with seeded events.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Seed = [type: string, payload: Payload, actor?: string];

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");

export const events = (project: Project): Record<string, unknown>[] =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

export function seed(project: Project, seeds: Seed[]): void {
  const start = events(project).length;
  const text = seeds.map(([type, payload, actor], i) =>
    JSON.stringify({ seq: start + i + 1, at: "2026-10-01T09:00:00Z", actor: actor ?? "you", type, payload }),
  );
  if (text.length > 0) appendFileSync(logOf(project), `${text.join("\n")}\n`);
}

export function withMap(seeds: Seed[]): Project {
  const project = freshProject();
  seed(project, seeds);
  return project;
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const ghost = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.proposed",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
  "agent",
];
export const link = (from: string, to: string, type: string, why?: string): Seed => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
export const decided = (id: string): Seed => ["node.decided", { id }];
export const reopen = (id: string, reason: string): Seed => ["node.reopened", { id, reason }];

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

export { freshProject, type Project };
