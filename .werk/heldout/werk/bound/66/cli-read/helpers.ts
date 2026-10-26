import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

/** Appends events in the person's name, with the next seq. */
export function seed(p: Project, list: { type: string; payload: object; actor?: string }[]): void {
  for (const e of list) {
    const seq = lines(p).length + 1;
    appendFileSync(
      logOf(p),
      `${JSON.stringify({ seq, at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`, actor: e.actor ?? "you", type: e.type, payload: e.payload })}\n`,
    );
  }
}

export const card = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});
export const edge = (from: string, to: string, type: string, why?: string) => ({
  type: "edge.added",
  payload: { from, to, type, ...(why ? { why } : {}) },
});

export function project(): Project {
  return freshProject();
}

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

export function chat(p: Project, name: string, rows: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

/** The first column of each non-empty output line. */
export const ids = (out: string) =>
  out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.trim().split(/\s+/)[0]);
