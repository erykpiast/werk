/** Helpers for the held-out tests. They drive the product through its command line and its own log writers. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appendBoardEvent } from "../src/board/log-store.ts";
import { appendEvents, readMap } from "../src/map/log-store.ts";

export const ROOT = resolve(import.meta.dirname, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export type Result = { code: number; stdout: string; stderr: string };

export type Proj = {
  dir: string;
  logPath: string;
  boardPath: string;
  run(...args: string[]): Result;
  seed(...events: Record<string, unknown>[]): void;
  seedBoard(...events: Record<string, unknown>[]): void;
  events(): Record<string, unknown>[];
  map(): ReturnType<typeof readMap>["map"];
  dispose(): void;
};

export function mkProj(): Proj {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  mkdirSync(join(dir, ".werk"));
  const logPath = join(dir, ".werk", "log.jsonl");
  const boardPath = join(dir, ".werk", "board.jsonl");
  return {
    dir,
    logPath,
    boardPath,
    run(...args) {
      const r = Bun.spawnSync(["bun", CLI, ...args], { cwd: dir });
      return {
        code: r.exitCode ?? -1,
        stdout: r.stdout.toString(),
        stderr: r.stderr.toString(),
      };
    },
    seed(...events) {
      const r = appendEvents(logPath, events);
      if (!r.ok) throw new Error(`seed refused: ${JSON.stringify(r.violation)}`);
    },
    seedBoard(...events) {
      for (const event of events) {
        const r = appendBoardEvent(boardPath, event);
        if (!r.ok) throw new Error(`seed refused: ${JSON.stringify(r.violation)}`);
      }
    },
    events() {
      return existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((l) => l !== "")
            .map((l) => JSON.parse(l))
        : [];
    },
    map: () => readMap(logPath).map,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

type CardOpts = {
  title?: string;
  why?: string;
  body?: string;
  parent?: string;
  status?: "open" | "proto";
  kind?: string;
};

/** Events for a real (accepted) card that is open. */
export function openCard(id: string, o: CardOpts = {}): Record<string, unknown>[] {
  return [
    {
      type: "node.proposed",
      id,
      kind: o.kind ?? "card",
      title: o.title ?? id,
      status: o.status ?? "open",
      ...(o.why ? { why: o.why } : {}),
      ...(o.body ? { body: o.body } : {}),
      ...(o.parent ? { parent: o.parent } : {}),
    },
    { type: "node.accepted", id, actor: "you" },
  ];
}

/** Events for a decided card: all four contract facts are given. The parent must be decided already. */
export function decidedCard(id: string, o: CardOpts = {}): Record<string, unknown>[] {
  return [
    ...openCard(id, o),
    { type: "node.edited", id, who: "me", noBasis: "held-out fixture" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  ];
}

export function writeFile(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
