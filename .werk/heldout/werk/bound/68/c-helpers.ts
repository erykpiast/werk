// Shared helpers of the binder's group C tests: a seeded project, CLI calls, and the map views.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fold } from "../src/map/fold.ts";
import { cardRead, shapeRead } from "../src/serve/map-api.ts";
import { freshProject, type Project } from "../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Seed = [type: string, payload: Payload];

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

/** A project whose log holds the given events, as real accepted nodes. */
export function seeded(events: Seed[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload], i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", type, payload }));
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const decided = (id: string, title: string, parent?: string, extra: Payload = {}): Seed =>
  card(id, title, parent, { status: "decided", who: "me", ...extra });
export const ghost = (id: string, title: string, parent?: string, extra: Payload = {}): Seed => [
  "node.proposed",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const link = (from: string, to: string, type: string, why?: string): Seed => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export async function werk(p: Project, ...args: string[]) {
  return p.werk(args);
}
export async function ok(p: Project, ...args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run.out;
}

/** The map as the server's graph read gives it. */
export function shape(p: Project) {
  return shapeRead(fold(readFileSync(logOf(p), "utf8")));
}
export function cardView(p: Project, id: string) {
  return cardRead(fold(readFileSync(logOf(p), "utf8")), id);
}
/** The ids of the cards that refine `parent` in the graph read. */
export function childrenOf(p: Project, parent: string): string[] {
  return shape(p)
    .edges.filter((e) => e.type === "refines" && e.to === parent)
    .map((e) => e.from)
    .sort();
}
export const nodeIds = (p: Project) => shape(p).nodes.map((n) => n.id);
export const hasLink = (p: Project, from: string, to: string) =>
  shape(p).edges.some((e) => e.from === from && e.to === to && e.type !== "refines");
/** The first line of `werk show`: the card's id, status and its mark word. */
export const header = (out: string) => out.split("\n")[0] ?? "";
