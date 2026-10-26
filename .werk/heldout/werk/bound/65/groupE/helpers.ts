import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

export const day = new Date().toISOString().slice(0, 10);
export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

export type Ev = { type: string; actor?: string; payload: object };

export function seeded(events: Ev[]): Project {
  const p = freshProject();
  seed(p, events);
  return p;
}

export function seed(p: Project, events: Ev[]): void {
  const start = lines(p).length;
  const text = events
    .map((e, i) =>
      JSON.stringify({
        seq: start + i + 1,
        at: `${day}T09:00:00Z`,
        actor: e.actor ?? "you",
        type: e.type,
        payload: e.payload,
      }),
    )
    .join("\n");
  appendFileSync(logOf(p), `${text}\n`);
}

export const card = (id: string, status: string, parent?: string, extra: object = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, status, who: "me", ...(parent && { parent }), ...extra },
});
export const dep = (from: string, to: string): Ev => ({
  type: "edge.added",
  actor: "agent",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
export const kill = (id: string): Ev => ({
  type: "kill.added",
  actor: "agent",
  payload: { id, criterion: { form: "revisit" } },
});

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
