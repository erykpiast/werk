import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
type Payload = Record<string, unknown>;
export type Ev = [string, Payload];
export const card = (id: string, title: string, parent?: string): Ev => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }) },
];
export const decided = (id: string): Ev => ["node.decided", { id }];
export const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
export function withMap(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}
export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
