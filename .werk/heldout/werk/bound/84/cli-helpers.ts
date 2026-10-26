import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export const logPath = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const logLines = (p: Project) =>
  readFileSync(logPath(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const logText = (p: Project) => readFileSync(logPath(p), "utf8");

type Ev = { type: string; actor?: string; payload: Record<string, unknown> };

/** Append events as the log would hold them (seq follows the existing lines). */
export function seed(p: Project, events: Ev[]): void {
  let n = logLines(p).length;
  const text = events
    .map((e) => JSON.stringify({ seq: ++n, at: "2026-10-01T09:00:00Z", actor: "you", ...e }))
    .join("\n");
  appendFileSync(logPath(p), `${text}\n`);
}

export const card = (id: string, title: string, o: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...o },
});

export function fresh(events: Ev[] = []): Project {
  const p = freshProject();
  seed(p, [card("root", "Root"), ...events]);
  return p;
}

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
