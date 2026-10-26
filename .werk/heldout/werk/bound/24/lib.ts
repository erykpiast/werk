import { appendFileSync } from "node:fs";
import { type Project, createProject } from "../src/test-env/project.ts";

export const CLI = `${import.meta.dirname}/../src/cli.ts`;

export async function werk(p: Project, ...args: string[]) {
  return p.run(["bun", CLI, ...args]);
}

/** Runs a werk command and returns it, failing the test loudly on a nonzero code. */
export async function ok(p: Project, ...args: string[]) {
  const r = await werk(p, ...args);
  if (r.code !== 0)
    throw new Error(`werk ${args.join(" ")} -> ${r.code}\n${r.stdout}${r.stderr}`);
  return r;
}

/** Appends raw map events straight to the log (setup only). */
export function raw(p: Project, ...events: Record<string, unknown>[]) {
  appendFileSync(p.logPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

export async function addCard(
  p: Project,
  id: string,
  title: string,
  opts: { parent?: string; why?: string; body?: string; status?: string; kind?: string } = {},
) {
  const a = ["add", id, "--title", title];
  if (opts.parent) a.push("--parent", opts.parent);
  if (opts.why) a.push("--why", opts.why);
  if (opts.body) a.push("--body", opts.body);
  if (opts.status) a.push("--status", opts.status);
  if (opts.kind) a.push("--kind", opts.kind);
  return ok(p, ...a);
}

export const accept = (p: Project, id: string) => ok(p, "accept", id, "--actor", "you");

export { createProject };

/** Accepts a card and takes it to decided with a waived basis and option. */
export async function decide(p: Project, id: string) {
  await ok(p, "edit", id, "--who", "you", "--no-basis", "root", "--unchallenged", "none");
  await ok(p, "kill", id, "--revisit");
  await accept(p, id);
  await ok(p, "status", id, "decided");
}

import { appendEvents } from "../src/map/log-store.ts";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Appends validated map events (setup only); throws when the log refuses one. */
export function ev(p: Project, ...events: Record<string, unknown>[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  const r = appendEvents(p.logPath, events);
  if (!r.ok) throw new Error(`setup refused: ${r.violation.rule}: ${r.violation.detail}`);
}

/** A real card in one step: a ghost event, then the person's accept. `status` may be decided. */
export function card(
  p: Project,
  id: string,
  title: string,
  o: { parent?: string; status?: string; why?: string; body?: string; kind?: string } = {},
) {
  const e: Record<string, unknown> = {
    type: "node.proposed",
    id,
    kind: o.kind ?? "card",
    title,
    status: o.status ?? "open",
  };
  if (o.parent) e.parent = o.parent;
  if (o.why) e.why = o.why;
  if (o.body) e.body = o.body;
  ev(p, e, { type: "node.accepted", id, actor: "you" });
}

/** A ghost card: proposed and never accepted. */
export function ghost(
  p: Project,
  id: string,
  title: string,
  o: { parent?: string; status?: string; why?: string; body?: string; kind?: string } = {},
) {
  const e: Record<string, unknown> = {
    type: "node.proposed",
    id,
    kind: o.kind ?? "card",
    title,
    status: o.status ?? "open",
  };
  if (o.parent) e.parent = o.parent;
  if (o.why) e.why = o.why;
  if (o.body) e.body = o.body;
  ev(p, e);
}

export function link(p: Project, from: string, to: string, type: string, why = "") {
  const e: Record<string, unknown> = { type: "edge.added", from, to, link: type };
  if (why) e.why = why;
  ev(p, e);
}

export function seedBoard(p: Project, ...events: Record<string, unknown>[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "board.jsonl"),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}
export const boardLines = (p: Project) =>
  readFileSync(join(p.dir, ".werk", "board.jsonl"), "utf8").trim().split("\n");
export const mapLog = (p: Project) =>
  existsSync(p.logPath) ? readFileSync(p.logPath, "utf8") : "";
export const DONE_TICKET = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
