import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type { Project };
export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

type Payload = Record<string, unknown>;
/** A project whose log holds events written as the person's accepted map would. */
export function withMap(evts: [type: string, payload: Payload][]): Project {
  const p = freshProject();
  if (evts.length > 0) {
    const text = evts.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
    appendFileSync(logOf(p), `${text.join("\n")}\n`);
  }
  return p;
}
export const card = (id: string, title: string, parent?: string, extra: Payload = {}): [string, Payload] => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const link = (from: string, to: string, type: string, why?: string): [string, Payload] => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
/** A note the person types in the map, appended as the map's own write would. */
export function personSays(p: Project, id: string, text: string): number {
  const seq = lines(p).length + 1;
  appendFileSync(logOf(p), `${JSON.stringify({ seq, at: "t", actor: "you", type: "note.added", payload: { id, text } })}\n`);
  return seq;
}
export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
