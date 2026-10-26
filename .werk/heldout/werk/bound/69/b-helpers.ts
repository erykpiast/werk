// Shared helpers of the b- held-out tests: a fresh project with seeded real cards, and log reads.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type P = Project & {
  log(): string[];
  events(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  real(id: string, title: string, parent?: string, extra?: Record<string, unknown>): void;
  w(...args: string[]): Promise<{ code: number; out: string; err: string }>;
  ok(...args: string[]): Promise<string>;
};

export function project(): P {
  const p = freshProject();
  const file = join(p.dir, ".werk", "log.jsonl");
  const log = () => readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  const real = (id: string, title: string, parent?: string, extra: Record<string, unknown> = {}) => {
    const seq = log().length + 1;
    const payload = { id, kind: "card", title, ...(parent ? { parent } : {}), ...extra };
    appendFileSync(file, `${JSON.stringify({ seq, at: "t", actor: "you", type: "node.added", payload })}\n`);
  };
  return Object.assign(p, {
    log,
    events: () => log().map((l) => JSON.parse(l)),
    real,
    w: (...args: string[]) => p.werk(args),
    ok: async (...args: string[]) => {
      const r = await p.werk(args);
      if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
      return r.out;
    },
  });
}

/** The first line of `werk show`: kind, id, status and marks. */
export const head = (out: string) => out.split("\n")[0] ?? "";
