// Helpers for the held-out tests: a fresh project from werk's own harness, seeded log events,
// and a reader of the decision log.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type Seed = { type: string; payload: Record<string, unknown>; actor?: string };

export type P = Project & {
  logFile: string;
  events(): Record<string, any>[];
  seed(events: Seed[]): void;
  chat(name: string, lines: Record<string, unknown>[]): void;
  w(...args: string[]): Promise<{ code: number; out: string; err: string }>;
};

export function project(): P {
  const p = freshProject();
  const logFile = join(p.dir, ".werk", "log.jsonl");
  const events = () =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => JSON.parse(l))
      : [];
  return Object.assign(p, {
    logFile,
    events,
    seed(list: Seed[]) {
      const start = events().length;
      const lines = list.map((e, i) =>
        JSON.stringify({ seq: start + i + 1, at: "2026-10-25T10:00:00.000Z", actor: e.actor ?? "you", type: e.type, payload: e.payload }),
      );
      mkdirSync(join(p.dir, ".werk"), { recursive: true });
      appendFileSync(logFile, `${lines.join("\n")}\n`);
    },
    chat(name: string, lines: Record<string, unknown>[]) {
      mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
      writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    },
    w: (...args: string[]) => p.werk(args),
  });
}

export const real = (id: string, title: string, parent?: string): Seed => ({
  type: "node.added",
  payload: { id, kind: "card", title, why: `${title} holds.`, ...(parent ? { parent } : {}) },
});
export const decided = (id: string): Seed => ({ type: "node.decided", payload: { id } });
