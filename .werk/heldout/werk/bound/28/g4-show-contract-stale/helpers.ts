import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

export function ev(p: Project, type: string, payload: object, actor = "you") {
  const at = `${new Date().toISOString().slice(0, 10)}T09:00:00Z`;
  appendFileSync(logOf(p), `${JSON.stringify({ seq: lines(p).length + 1, at, actor, type, payload })}\n`);
}

export function card(p: Project, id: string, extra: Record<string, unknown> = {}) {
  ev(p, "node.added", { id, kind: "card", title: `Card ${id}`, ...extra });
}

/** A decided card with every fact: who me, a revisit kill criterion. Basis from extra or parent. */
export function decided(p: Project, id: string, extra: Record<string, unknown> = {}) {
  card(p, id, { status: "decided", who: "me", ...extra });
  ev(p, "kill.added", { id, criterion: { form: "revisit" } });
}

export function dep(p: Project, from: string, to: string) {
  ev(p, "edge.added", { from, to, type: "depends_on", why: `${from} uses ${to}` });
}

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** Split a printed shell command line into words, honouring double quotes. */
export function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : (m[2] as string));
  return out;
}

/** The printed fix commands (lines that start with werk, or: werk, then: werk). */
export function printedCommands(err: string): string[][] {
  return err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(or: |then: )?werk /.test(l) && !l.startsWith("werk status:") && !l.startsWith("werk unlink:"))
    .map((l) => words(l.replace(/^(or: |then: )/, "")));
}

export { freshProject, type Project };
