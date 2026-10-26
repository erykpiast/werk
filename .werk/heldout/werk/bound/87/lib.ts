// Helpers of the held-out tests: seed a map log and run werk against a fresh project.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export { freshProject };
export type { Project };

export const logPath = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logPath(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: any });

export function seed(p: Project, type: string, payload: object, actor = "you"): void {
  appendFileSync(logPath(p), `${JSON.stringify({ seq: lines(p).length + 1, at: "2026-01-01T00:00:00.000Z", actor, type, payload })}\n`);
}

/** A real card. Defaults: decided, who me, under root. */
export function card(p: Project, id: string, fields: Record<string, unknown> = {}): void {
  seed(p, "node.added", { id, kind: "card", title: id, parent: id === "root" ? undefined : "root", status: "decided", who: "me", ...fields });
}

/** A project with a decided root card. */
export function withRoot(): Project {
  const p = freshProject();
  card(p, "root", { title: "Root", parent: undefined });
  return p;
}

export async function w(p: Project, ...args: string[]) {
  return p.werk(args);
}

export async function ok(p: Project, ...args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}
