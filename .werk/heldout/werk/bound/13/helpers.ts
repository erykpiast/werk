// Shared helpers of the held-out tests. They drive werk through its command line in a fresh project.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type P = Project & {
  log: string;
  /** Append raw events as the given state of the map. */
  seed(...events: { type: string; actor?: string; payload: object }[]): void;
  lines(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  ok(...args: string[]): Promise<string>;
};

export function project(): P {
  const p = freshProject();
  const log = join(p.dir, ".werk", "log.jsonl");
  const lines = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
  return Object.assign(p, {
    log,
    lines,
    seed: (...events: { type: string; actor?: string; payload: object }[]) => {
      let seq = lines().length;
      for (const event of events) {
        seq += 1;
        appendFileSync(log, `${JSON.stringify({ seq, at: "2026-10-01T09:00:00Z", actor: "you", ...event })}\n`);
      }
    },
    ok: async (...args: string[]) => {
      const run = await p.werk(args);
      if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
      return run.out;
    },
  });
}

export const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

export function chat(p: { dir: string }, name: string, messages: { kind: string; speaker: string; text: string; at?: string }[]) {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    messages
      .map((m, i) =>
        JSON.stringify({
          speaker: m.speaker,
          at: m.at ?? `2026-10-01T10:0${i}:00Z`,
          session: "sess-1",
          kind: m.kind,
          text: m.text,
        }),
      )
      .map((line) => `${line}\n`)
      .join(""),
  );
}
