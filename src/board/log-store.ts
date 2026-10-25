/** Reads and appends the board log of one project, beside the map log (#vi-board-state). */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLog } from "../map/fold.ts";
import { logPathFor as mapLogPath } from "../map/log-store.ts";
import {
  applyBoardEvent,
  type Board,
  type BoardViolation,
  foldBoard,
} from "./fold.ts";

type Env = Record<string, string | undefined>;

/** The board log of the project, in the folder of its map log. */
export function boardLogPathFor(cwd: string, env: Env): string {
  return boardLogBeside(mapLogPath(cwd, env));
}

/** The board log that sits beside a map log. */
export function boardLogBeside(mapLog: string): string {
  return join(dirname(mapLog), "board.jsonl");
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function readBoard(path: string): Board {
  return foldBoard(parseLog(readText(path)));
}

export type BoardAppendResult =
  | { ok: true }
  | { ok: false; violation: BoardViolation };

/** Checks the event against the folded board, then appends it. A refused event leaves the log as it was. */
export function appendBoardEvent(
  path: string,
  event: unknown,
): BoardAppendResult {
  const violation = applyBoardEvent(readBoard(path), event);
  if (violation) return { ok: false, violation };
  const text = readText(path);
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${lead}${JSON.stringify(event)}\n`);
  return { ok: true };
}

/** True when a process with this id exists. A permission error still means it exists. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
