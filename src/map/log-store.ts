/** Reads and appends the map log of one project. The command line is the only writer (#werk-write). */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyEvent,
  type FoldedMap,
  fold,
  parseLog,
  type Violation,
} from "./fold.ts";

type Env = Record<string, string | undefined>;

/** The log of the project that the command runs in. WERK_LOG names another log. */
export function logPathFor(cwd: string, env: Env): string {
  return env.WERK_LOG ?? join(cwd, ".werk", "log.jsonl");
}

/** The file that holds the time of each fold, beside the log (#pr-log-snapshot). */
function foldTimesPath(logPath: string): string {
  return join(dirname(logPath), "fold-ms.jsonl");
}

function readText(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

/** Replays the whole log, and records how long the fold took. */
export function readMap(logPath: string): { map: FoldedMap; ms: number } {
  const entries = parseLog(readText(logPath));
  const start = performance.now();
  const map = fold(entries);
  const ms = performance.now() - start;
  try {
    appendFileSync(
      foldTimesPath(logPath),
      `${JSON.stringify({ at: new Date().toISOString(), events: entries.length, ms })}\n`,
    );
  } catch {
    // The time is a measure. A folder that refuses it must not stop a read.
  }
  return { map, ms };
}

export type AppendResult =
  | { ok: true; appended: number }
  | { ok: false; violation: Violation; index: number };

/**
 * Checks each event against the folded map, in order, and appends all of them or none.
 * An event that breaks a rule is refused with the rule, and the log stays as it was.
 */
export function appendEvents(
  logPath: string,
  events: readonly unknown[],
): AppendResult {
  const { map } = readMap(logPath);
  for (const [index, event] of events.entries()) {
    const violation = applyEvent(map, event);
    if (violation) return { ok: false, violation, index };
  }
  const text = readText(logPath);
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(
    logPath,
    lead + events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  );
  return { ok: true, appended: events.length };
}
