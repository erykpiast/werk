// The decision log on disk. Every read folds the whole log and records how long the fold took
// (#pr-log-snapshot); every write checks its events against that fold and appends them all in
// one write, or refuses and appends nothing (#pr-log-refuse, #werk-write).
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { prepare, toLines } from "./commit.ts";
import { fold } from "./fold.ts";
import type { Draft, Event, FoldedMap } from "./types.ts";

/** The log: WERK_LOG when it is set, else `.werk/log.jsonl` in the nearest folder up from `cwd` that has a `.werk`. */
export function logPath(cwd = process.cwd(), env = process.env): string {
  if (env.WERK_LOG) return env.WERK_LOG;
  for (let dir = cwd; ; dir = dirname(dir)) {
    const werk = join(dir, ".werk");
    if (existsSync(werk) && statSync(werk).isDirectory()) return join(werk, "log.jsonl");
    if (dirname(dir) === dir) return join(cwd, ".werk", "log.jsonl");
  }
}

/** The fold times sit beside the log, one JSON line per fold. */
export function foldTimesPath(log: string): string {
  return join(dirname(log), "fold-times.jsonl");
}

function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Folds the whole log and records the fold time. `via` names the read that ran the fold. */
export function readMap(via: string, path: string): FoldedMap {
  const text = readLog(path);
  const started = performance.now();
  const map = fold(text);
  const ms = Math.round((performance.now() - started) * 100) / 100;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const line = { at: new Date().toISOString(), lines: text.split("\n").length - 1, ms, via };
    appendFileSync(foldTimesPath(path), `${JSON.stringify(line)}\n`);
  } catch {
    // A read never fails because its fold time could not be written.
  }
  return map;
}

/** A write that breaks a map rule. Nothing was appended. */
export class Refused extends Error {}

/** Appends the drafts as events, all or none. Throws Refused with the broken rule. */
export function write(map: FoldedMap, drafts: Draft[], path: string): Event[] {
  const prepared = prepare(map, drafts, new Date().toISOString());
  if (!prepared.ok) throw new Refused(`refused: ${prepared.rule}`);
  mkdirSync(dirname(path), { recursive: true });
  const text = readLog(path);
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  appendFileSync(path, lead + toLines(prepared.events));
  return prepared.events;
}
