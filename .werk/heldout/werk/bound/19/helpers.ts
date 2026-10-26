// Held-out test helpers: a temp project from the product's own harness, plus a seed that
// appends log lines for Given state that has no command (a real card, a person's note).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Ctx = Project & {
  log(): Record<string, unknown>[];
  seed(type: string, payload: Record<string, unknown>, actor?: "you" | "agent"): void;
  real(id: string, title: string, parent?: string, extra?: Record<string, unknown>): void;
  personNote(id: string, text: string): number;
  ok(args: string[]): Promise<string>;
};

export function project(): Ctx {
  const p = freshProject();
  const path = join(p.dir, ".werk", "log.jsonl");
  const log = () =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l));
  const seed = (type: string, payload: Record<string, unknown>, actor: "you" | "agent" = "you") => {
    const seq = log().length + 1;
    appendFileSync(path, `${JSON.stringify({ seq, at: new Date().toISOString(), actor, type, payload })}\n`);
  };
  return Object.assign(p, {
    log,
    seed,
    real: (id: string, title: string, parent?: string, extra: Record<string, unknown> = {}) =>
      seed("node.added", { id, kind: "card", title, ...(parent ? { parent } : {}), ...extra }),
    personNote: (id: string, text: string) => {
      seed("note.added", { id, text }, "you");
      return log().length;
    },
    ok: async (args: string[]) => {
      const r = await p.werk(args);
      if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
      return r.out;
    },
  });
}
