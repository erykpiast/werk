// Shared helpers of the cli-a held-out tests.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Seed = [type: string, payload: Payload];

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");
export const events = (project: Project) => lines(project).map((line) => JSON.parse(line));

/** A project whose log holds the given events, written by the person. */
export function withMap(seed: Seed[]): Project {
  const project = freshProject();
  const text = seed.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(project), `${text.join("\n")}\n`);
  return project;
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const decided = (id: string): Seed => ["node.decided", { id }];
export const link = (from: string, to: string, type: string, why?: string): Seed => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export async function ok(project: Project, args: string[]): Promise<Run> {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** The first line of a show: "<kind> <id>  [<status>]  <flags>". */
export const header = (out: string) => out.split("\n")[0] ?? "";
export const isGhost = (out: string) => /\bproposed\b/.test(header(out));

export async function show(project: Project, id: string): Promise<Run> {
  return project.werk(["show", id]);
}
