import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

export const CLI = join(import.meta.dir, "..", "src", "cli.ts");
export { createProject };
export type { Project };

export function werkIn(p: Project) {
  return (...args: string[]) => p.run(["bun", CLI, ...args]);
}

type Ev = Record<string, unknown>;

/** Events that make a decided card. */
export function decidedCard(id: string, title: string, parent?: string, extra: Ev = {}): Ev[] {
  const node: Ev = { type: "node.proposed", id, kind: "card", title, status: "open", why: `why ${id}`, ...extra };
  if (parent) node.parent = parent;
  return [
    node,
    { type: "node.accepted", id, actor: "you" },
    { type: "node.edited", id, who: "you", noBasis: "root", unchallenged: "none" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  ];
}
export function openCard(id: string, title: string, parent?: string, extra: Ev = {}): Ev[] {
  const node: Ev = { type: "node.proposed", id, kind: "card", title, status: "open", why: `why ${id}`, ...extra };
  if (parent) node.parent = parent;
  return [node, { type: "node.accepted", id, actor: "you" }];
}
export function writeLog(p: Project, events: (Ev | string)[]) {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(p.logPath, events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n");
}
export function appendLog(p: Project, events: Ev[]) {
  const old = existsSync(p.logPath) ? readFileSync(p.logPath, "utf8") : "";
  writeFileSync(p.logPath, old + events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
export const logText = (p: Project) => (existsSync(p.logPath) ? readFileSync(p.logPath, "utf8") : "");
export const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
