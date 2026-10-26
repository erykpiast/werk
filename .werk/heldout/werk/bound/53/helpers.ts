// Shared helpers of the held-out tests: a fresh project, a seeded log, and the log lines.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type { Project };
export const logOf = (project: Project) => join(project.dir, ".werk", "log.jsonl");
export const lines = (project: Project) =>
  readFileSync(logOf(project), "utf8")
    .split("\n")
    .filter((line) => line !== "");
export const events = (project: Project) => lines(project).map((line) => JSON.parse(line));

/** A fresh project whose log holds the given events, written as the person's. */
export function seeded(list: { type: string; payload: object; actor?: string }[]): Project {
  const project = freshProject();
  seed(project, list);
  return project;
}

export function seed(project: Project, list: { type: string; payload: object; actor?: string }[]): void {
  const start = lines(project).length;
  appendFileSync(
    logOf(project),
    list
      .map((event, i) =>
        JSON.stringify({ seq: start + i + 1, at: "2026-10-25T10:00:00.000Z", actor: event.actor ?? "you", type: event.type, payload: event.payload }),
      )
      .map((line) => `${line}\n`)
      .join(""),
  );
}

export const card = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

export const decided = (id: string, title: string, extra: object = {}) =>
  card(id, title, { status: "decided", who: "me", no_basis: "seed", ...extra });

export async function ok(project: Project, args: string[]) {
  const run = await project.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}\n${run.out}`);
  return run;
}
