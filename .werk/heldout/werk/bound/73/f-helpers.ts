// Helpers of the binder's group F tests: a fresh project seeded from a list of events.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

export function seeded(events: { type: string; payload: object }[]): Project {
  const p = freshProject();
  appendFileSync(
    logOf(p),
    events.map((e, i) => `${JSON.stringify({ seq: i + 1, at: new Date().toISOString(), actor: "you", ...e })}\n`).join(""),
  );
  return p;
}

export const card = (id: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...extra },
});
export const kill = (id: string) => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
export const dep = (from: string, to: string) => ({
  type: "edge.added",
  payload: { from, to, type: "depends_on", why: `${from} uses ${to}` },
});
export const refines = (from: string, to: string) => ({ type: "edge.added", payload: { from, to, type: "refines" } });

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** The first line of `werk show <id>`. */
export async function head(p: Project, id: string): Promise<string> {
  return (await ok(p, ["show", id])).out.split("\n")[0] as string;
}
