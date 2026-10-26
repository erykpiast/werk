// Held-out helpers: seed a log directly and read it back.
import { setDefaultTimeout } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";

export const logFile = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logFile(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: any });

export type Ev = { type: string; payload: any; actor?: string };
export function seed(p: Project, evs: Ev[]) {
  let seq = lines(p).length;
  appendFileSync(
    logFile(p),
    evs.map((e) => `${JSON.stringify({ seq: ++seq, at: "2026-01-01T00:00:00Z", actor: e.actor ?? "you", ...e })}\n`).join(""),
  );
}
/** A real card event. */
export const card = (id: string, o: Record<string, any> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: o.title ?? id, parent: o.parent ?? "root", status: "open", ...o },
});
export const decided = (id: string, o: Record<string, any> = {}): Ev =>
  card(id, { status: "decided", who: "me", no_basis: "top", ...o });
export const root = (): Ev[] => [
  { type: "node.added", payload: { id: "root", kind: "card", title: "Root", status: "decided", who: "me", no_basis: "top" } },
];
export const edge = (from: string, to: string, type = "depends_on", why = "needs it"): Ev => ({
  type: "edge.added",
  payload: { from, to, type, ...(type === "depends_on" ? { why } : {}) },
});
export const kill = (id: string): Ev => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
export const proposed = (id: string, o: Record<string, any> = {}): Ev => ({
  type: "node.proposed",
  actor: "agent",
  payload: { id, kind: "card", title: o.title ?? id, parent: o.parent ?? "root", ...o },
});
export async function w(p: Project, args: string[], opts?: any) {
  return p.werk(args, opts);
}
export async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}

setDefaultTimeout(90000);
