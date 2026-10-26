import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; actor: string; payload: any });
export const day = new Date().toISOString().slice(0, 10);

export type Ev = [type: string, payload: Record<string, unknown>];
/** Append accepted (real) events to the log, as a person's accepted map would hold. */
export function seed(p: Project, list: Ev[]) {
  const start = lines(p).length;
  appendFileSync(
    logOf(p),
    list.map(([type, payload], i) => `${JSON.stringify({ seq: start + i + 1, at: `${day}T09:00:00Z`, actor: "you", type, payload })}\n`).join(""),
  );
}
export const card = (id: string, o: Record<string, unknown> = {}): Ev => ["node.added", { id, kind: "card", title: o.title ?? `Card ${id}`, ...o }];
/** A real decided card with who me, no basis waiver and a kill criterion: every decide fact. */
export const decided = (id: string, o: Record<string, unknown> = {}): Ev[] => [
  card(id, { status: "decided", who: "me", ...(o.parent === undefined ? { no_basis: "top" } : {}), ...o }),
  ["kill.added", { id, criterion: { form: "revisit" } }],
];
export const dep = (from: string, to: string): Ev => ["edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` }];

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** Split a printed command line into arguments; double quotes group words. */
export function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? (m[2] as string));
}
