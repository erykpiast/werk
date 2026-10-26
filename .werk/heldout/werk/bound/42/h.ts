// Shared helpers of the held-out tests.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type H = ReturnType<typeof mk>;

export function mk() {
  const p = freshProject();
  const logFile = join(p.dir, ".werk", "log.jsonl");
  const lines = () =>
    readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean);
  const events = () => lines().map((l) => JSON.parse(l) as { seq: number; actor: string; type: string; payload: any });
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(logFile, `${JSON.stringify({ seq: lines().length + 1, at: new Date().toISOString(), actor, type, payload })}\n`);
  const real = (id: string, title: string, parent?: string, extra: object = {}) =>
    seed("node.added", { id, kind: "card", title, why: `why ${id}`, ...(parent ? { parent } : {}), ...extra });
  const decide = (id: string) => seed("node.decided", { id });
  const edge = (from: string, to: string, type: string, why?: string) =>
    seed("edge.added", { from, to, type, ...(why ? { why } : {}) });
  const w = (...args: string[]) => p.werk(args);
  const out = async (...args: string[]) => {
    const r = await p.werk(args);
    return r.out + r.err;
  };
  return { p, logFile, lines, events, seed, real, decide, edge, w, out, count: () => lines().length };
}

export const all = (r: Run) => r.out + r.err;
export { mkdirSync, writeFileSync, readFileSync, join, appendFileSync };
export type { Project, Run };
