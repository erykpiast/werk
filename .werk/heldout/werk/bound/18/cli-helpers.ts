// Shared helpers of the held-out command-line tests.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; actor: string; payload: Payload });

/** A project whose log holds the given events, as real (person-written) history. */
export function seeded(list: [type: string, payload: Payload, actor?: string][]): Project {
  const p = freshProject();
  seed(p, list);
  return p;
}
export function seed(p: Project, list: [type: string, payload: Payload, actor?: string][]): void {
  const start = lines(p).length;
  const text = list.map(([type, payload, actor], i) =>
    JSON.stringify({ seq: start + i + 1, at: "2026-10-01T09:00:00Z", actor: actor ?? "you", type, payload }),
  );
  if (text.length > 0) appendFileSync(logOf(p), `${text.join("\n")}\n`);
}
export const card = (id: string, title: string, extra: Payload = {}): [string, Payload] => [
  "node.added",
  { id, kind: "card", title, ...extra },
];
export const link = (from: string, to: string, type: string, why?: string): [string, Payload] => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}
export function chat(p: Project, name: string, rows: Payload[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}
