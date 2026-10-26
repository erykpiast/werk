import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Project, freshProject } from "../src/test/project.ts";

export { freshProject };
export type { Project };

export const logFile = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const logLines = (p: Project) =>
  readFileSync(logFile(p), "utf8")
    .split("\n")
    .filter(Boolean);
export const logText = (p: Project) => readFileSync(logFile(p), "utf8");
export const events = (p: Project) => logLines(p).map((l) => JSON.parse(l));

/** Append one raw event to the log, as a person's tool would. */
export function seed(p: Project, type: string, payload: object, actor = "you"): void {
  const n = logLines(p).length + 1;
  appendFileSync(logFile(p), `${JSON.stringify({ seq: n, at: "2026-01-01T00:00:00.000Z", actor, type, payload })}\n`);
}
export function card(p: Project, id: string, f: Record<string, unknown> = {}): void {
  seed(p, "node.added", { id, kind: "card", title: id, parent: "root", ...f });
}
export function root(p: Project): void {
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: "open" });
}
export async function w(p: Project, ...args: string[]) {
  return p.werk(args);
}
export const all = (r: { out: string; err: string }) => r.out + r.err;

export function chat(p: Project, name: string, lines: { kind: string; text: string; speaker?: string; at?: string; session?: string }[]): void {
  const { mkdirSync, writeFileSync } = require("node:fs");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${lines.map((l) => JSON.stringify({ speaker: "person", at: "t", session: "sess1", ...l })).join("\n")}\n`,
  );
}
export const NOT_IN_MAP = /in the map|not found|no node/i;
