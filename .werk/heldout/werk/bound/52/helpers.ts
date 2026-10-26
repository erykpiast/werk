// Shared helpers for the held-out tests: a fresh project from the repo harness, log seeding and reads.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type { Project, Run };

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");

export function lines(p: Project): Record<string, unknown>[] {
  return readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
}

/** Append events as the person ("you") with consecutive seq numbers. */
export function seed(p: Project, events: { type: string; payload: object; actor?: string }[]): void {
  let seq = lines(p).length;
  const text = events
    .map((e) => JSON.stringify({ seq: ++seq, at: "2026-01-01T00:00:00.000Z", actor: e.actor ?? "you", type: e.type, payload: e.payload }))
    .join("\n");
  appendFileSync(logOf(p), `${text}\n`);
}

export const card = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});
export const decided = (id: string) => ({ type: "node.decided", payload: { id } });

export function project(): Project {
  return freshProject();
}

export async function ok(p: Project, args: string[]): Promise<Run> {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.out}${run.err}`);
  return run;
}

export function chat(p: Project, name: string, rows: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}
