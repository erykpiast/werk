// Held-out test helpers: a fresh project with a seeded log, driven through the werk command line.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type Map = Project & {
  seed(type: string, payload: object, actor?: string): void;
  events(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  w(...args: string[]): Promise<Run>;
};

export function map(): Map {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const events = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const seed = (type: string, payload: object, actor = "you") => {
    const text = readFileSync(log, "utf8");
    writeFileSync(log, `${text}${JSON.stringify({ seq: events().length + 1, at: "t", actor, type, payload })}\n`);
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });
  return Object.assign(p, { seed, events, w: (...args: string[]) => p.werk(args) });
}

/** A real card. */
export function card(m: Map, id: string, title: string, parent = "root", extra: object = {}): void {
  m.seed("node.added", { id, kind: "card", title, parent, ...extra });
}
