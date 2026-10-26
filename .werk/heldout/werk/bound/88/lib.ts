import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export { freshProject };
export type { Project };
export type Ev = [type: string, payload: Record<string, unknown>, actor?: string];

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const logLines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

/** Append raw events to the decision log, as a person's accepted map would be. */
export function seed(p: Project, events: Ev[]): void {
  const start = logLines(p).length;
  const text = events.map(([type, payload, actor], i) =>
    JSON.stringify({ seq: start + i + 1, at: "2026-10-01T09:00:00Z", actor: actor ?? "you", type, payload }),
  );
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
}
export const card = (id: string, title: string, status: string, parent?: string, extra: Record<string, unknown> = {}): Ev => [
  "node.added",
  { id, kind: "card", title, status, ...(parent ? { parent } : {}), ...extra },
];
export const ghost = (id: string, title: string, status: string, parent?: string, extra: Record<string, unknown> = {}): Ev => [
  "node.proposed",
  { id, kind: "card", title, status, ...(parent ? { parent } : {}), ...extra },
  "agent",
];
export const edge = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why ? { why } : {}) },
];

export async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

export function chat(p: Project, name: string, lines: { kind: string; text: string; speaker: string; at: string }[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${lines.map((l) => JSON.stringify({ ...l, session: "6ae61be7" })).join("\n")}\n`,
  );
}
