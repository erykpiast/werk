// Held-out binder helper: a fresh project, a werk runner and log seeding. Uses only the repo's own test harness.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type H = {
  p: Project;
  dir: string;
  /** run werk in the project */
  w(...args: string[]): Promise<Run>;
  /** run werk and require exit 0, returns stdout */
  ok(...args: string[]): Promise<string>;
  /** append a log event as the person (actor you) */
  seed(type: string, payload: object, actor?: string): void;
  /** seed a real card quickly */
  card(id: string, fields?: Record<string, unknown>): void;
  logText(): string;
  events(): any[];
  count(): number;
};

export function mk(withRoot = true): H {
  const p = freshProject();
  const logFile = join(p.dir, ".werk", "log.jsonl");
  const events = () =>
    readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(logFile, `${JSON.stringify({ seq: events().length + 1, at: "t", actor, type, payload })}\n`);
  const h: H = {
    p,
    dir: p.dir,
    w: (...args) => p.werk(args),
    ok: async (...args) => {
      const r = await p.werk(args);
      if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exit ${r.code}: ${r.err}${r.out}`);
      return r.out;
    },
    seed,
    card: (id, fields = {}) =>
      seed("node.added", { id, kind: "card", title: id, parent: "root", ...fields }),
    logText: () => readFileSync(logFile, "utf8"),
    events,
    count: () => events().length,
  };
  if (withRoot) seed("node.added", { id: "root", kind: "card", title: "Root" });
  return h;
}
export { writeFileSync };

/** Write a chat log .werk/chats/<name>.jsonl */
export function chat(h: H, name: string, lines: object[]) {
  const { mkdirSync } = require("node:fs");
  mkdirSync(join(h.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(h.dir, ".werk", "chats", `${name}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
export const said = (speaker: string, text: string, at = "2026-01-01T00:00:00Z", session = "sess-1") => ({
  speaker, at, session, kind: "spoken", text,
});
