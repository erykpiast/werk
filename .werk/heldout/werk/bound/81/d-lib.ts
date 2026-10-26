import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export const day = new Date().toISOString().slice(0, 10);
export type Ev = { type: string; actor?: string; payload: Record<string, unknown> };

export function seed(project: Project, events: Ev[]) {
  const log = join(project.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const text = events
    .map((e, i) => JSON.stringify({ seq: n + i + 1, at: `${day}T09:00:00Z`, actor: "you", ...e }))
    .join("\n");
  appendFileSync(log, `${text}\n`);
}
export const card = (id: string, parent?: string, status = "decided"): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, status, who: "me", ...(parent ? { parent } : {}) },
});
export const dep = (from: string, to: string): Ev => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
export const refines = (from: string, to: string): Ev => ({
  type: "edge.added",
  payload: { from, to, type: "refines" },
});
export const kill = (id: string): Ev => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
export { freshProject };
