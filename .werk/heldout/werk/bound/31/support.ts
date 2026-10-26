import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvents } from "../src/map/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export { createProject, type Project };

/** Runs one werk command in the project. */
export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Appends events through the product's own write check; a refusal is a binder error. */
export function ev(p: Project, ...events: unknown[]): void {
  const r = appendEvents(p.logPath, events);
  if (!r.ok)
    throw new Error(
      `setup refused: ${r.violation.rule}: ${r.violation.detail} (${JSON.stringify(events[r.index])})`,
    );
}

/** Appends one raw line, with no check. */
export function raw(p: Project, event: unknown): void {
  appendFileSync(p.logPath, `${JSON.stringify(event)}\n`);
}

export type CardOpts = {
  parent?: string;
  why?: string;
  body?: string;
  status?: "open" | "proto";
  kind?: "card" | "option" | "source" | "excerpt";
};

/** Proposes and accepts one card (a real card, not decided). */
export function card(p: Project, id: string, title: string, o: CardOpts = {}) {
  const e: Record<string, unknown> = {
    type: "node.proposed",
    id,
    kind: o.kind ?? "card",
    title,
    status: o.status ?? "open",
  };
  if (o.why !== undefined) e.why = o.why;
  if (o.body !== undefined) e.body = o.body;
  if (o.parent !== undefined) e.parent = o.parent;
  ev(p, e, { type: "node.accepted", id, actor: "you" });
}

/** Makes a card real and decided: who, a basis waiver, a kill criterion, then decided. */
export function decided(p: Project, id: string, title: string, o: CardOpts = {}) {
  card(p, id, title, o);
  ev(
    p,
    { type: "node.edited", id, who: "me", noBasis: "seed" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  );
}

export const link = (
  p: Project,
  from: string,
  to: string,
  type: string,
  why = "",
) =>
  ev(p, {
    type: "edge.added",
    from,
    to,
    link: type,
    ...(why ? { why } : {}),
  });

export const eventCount = (p: Project) => p.events().length;

export const logText = (p: Project) => readFileSync(p.logPath, "utf8");
