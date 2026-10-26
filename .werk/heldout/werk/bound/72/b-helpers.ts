// Helpers of fork B's held-out tests: seed events into a fresh project's log, and read the log.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type P = Project & {
  log(): string[];
  seed(type: string, payload: object, actor?: string): void;
  card(id: string, fields?: Record<string, unknown>): void;
  must(args: string[]): Promise<string>;
};

export function project(): P {
  const p = freshProject();
  const file = join(p.dir, ".werk", "log.jsonl");
  const log = () => readFileSync(file, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(
      file,
      `${JSON.stringify({ seq: log().length + 1, at: new Date().toISOString(), actor, type, payload })}\n`,
    );
  const card = (id: string, fields: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title: id, ...fields });
  const must = async (args: string[]) => {
    const r = await p.werk(args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
    return r.out;
  };
  return Object.assign(p, { log, seed, card, must });
}

/** A decided card with every fact of the contract, seeded as real. */
export function decided(p: P, id: string, fields: Record<string, unknown> = {}): void {
  p.card(id, { status: "decided", who: "me", ...fields });
}
