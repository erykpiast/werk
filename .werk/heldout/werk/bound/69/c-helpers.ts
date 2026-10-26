// Shared helpers of the c- held-out tests: a fresh project seeded with an accepted map.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

export function withMap(events: [type: string, payload: Payload][]): Project {
  const project = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(project), `${text.join("\n")}\n`);
  return project;
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): [string, Payload] => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const node = (payload: Payload): [string, Payload] => ["node.added", payload];
export const link = (from: string, to: string, type: string, why?: string): [string, Payload] => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.out}${run.err}`);
  return run;
}
