import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type P = Project & {
  lines(): string[];
  events(): { type: string; actor: string; payload: Record<string, unknown> }[];
};

export function project(): P {
  const p = freshProject() as P;
  const log = join(p.dir, ".werk", "log.jsonl");
  p.lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  p.events = () => p.lines().map((l) => JSON.parse(l));
  return p;
}

/** A real card through the command line: add, then accept with the person's claim. */
export async function real(p: P, id: string, title: string, parent?: string, extra: string[] = []): Promise<void> {
  const add = await p.werk(["add", id, "--title", title, ...(parent ? ["--parent", parent] : []), ...extra]);
  if (add.code !== 0) throw new Error(`add ${id}: ${add.err}`);
  const ok = await p.werk(["accept", id, "--actor", "you"]);
  if (ok.code !== 0) throw new Error(`accept ${id}: ${ok.err}`);
}

/** A real card written straight into the log, as the browser harness seeds one (for a decided status). */
export function seed(p: P, id: string, fields: Record<string, unknown> = {}): void {
  const log = join(p.dir, ".werk", "log.jsonl");
  const seq = p.lines().length + 1;
  appendFileSync(
    log,
    `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload: { id, kind: "card", title: id, ...fields } })}\n`,
  );
}

export async function show(p: P, id?: string) {
  return p.werk(id === undefined ? ["show"] : ["show", id]);
}

/** The refines children that `show` lists for a card. */
export function children(showOut: string): string[] {
  return [...showOut.matchAll(/^\s+<- refines\s+(\S+)/gm)].map((m) => m[1] as string);
}
