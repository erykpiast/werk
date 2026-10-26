// Shared helpers of the cli-b held-out tests.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Ev = [type: string, payload: Payload];

export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");

export const day = new Date().toISOString().slice(0, 10);

/** Append events to the log, numbering seq after what is there. */
export function seed(project: Project, events: Ev[]): void {
  const at = lines(project).length;
  const text = events
    .map(([type, payload], i) => JSON.stringify({ seq: at + i + 1, at: `${day}T09:00:00Z`, actor: "you", type, payload }))
    .join("\n");
  appendFileSync(logOf(project), `${text}\n`);
}

export function withMap(events: Ev[]): Project {
  const project = freshProject();
  seed(project, events);
  return project;
}

export const card = (id: string, title: string, extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, status: "open", ...extra },
];
/** A decided card with every fact: who me, no basis waived, revisit kill. */
export const decided = (id: string, title: string, extra: Payload = {}): Ev[] => [
  ["node.added", { id, kind: "card", title, status: "decided", who: "me", no_basis: "a top fact", ...extra }],
  ["kill.added", { id, criterion: { form: "revisit" } }],
];
export const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
export const dep = (from: string, to: string): Ev => link(from, to, "depends_on", `${from} uses ${to}`);

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** Split a printed command line ("werk kill x --revisit") into its arguments, honouring double quotes. */
export function argsOf(command: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null = re.exec(command);
  while (m !== null) {
    out.push(m[1] ?? (m[2] as string));
    m = re.exec(command);
  }
  return out[0] === "werk" ? out.slice(1) : out;
}
