import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

type Payload = Record<string, unknown>;
export type Ev = [type: string, payload: Payload];

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

export function withMap(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) =>
    JSON.stringify({ seq: i + 1, at: "2026-10-01T09:00:00Z", actor: "you", type, payload }),
  );
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}

export const card = (id: string, title: string, parent?: string, status = "open", extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, status, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** Ids at the start of each output line. */
export const ids = (out: string) =>
  out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("  ")[0]);

/** The direct children that `show` lists under a card. */
export const childrenIn = (out: string) =>
  [...out.matchAll(/^ {2}<- refines\s+(\S+)/gm)].map((m) => m[1]);
