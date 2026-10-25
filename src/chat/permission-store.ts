/**
 * The two files an approval leaves beside the map log: the ask log, and the updates that Always
 * allow kept for the project's conversation (#werk-approve-log, #werk-mc-allow, #werk-approve).
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Logged, Update } from "./permission.ts";

export type AskRecord = {
  at: string;
  tool: string;
  label: string;
  input: unknown;
  reason: string | null;
  decision: Logged;
  widened: string[];
};

export const asksPathBeside = (logPath: string) =>
  join(dirname(logPath), "asks.jsonl");
export const allowPathBeside = (logPath: string) =>
  join(dirname(logPath), "allow.json");

/** Appends one line. The log is never rewritten. */
export function appendAsk(logPath: string, record: AskRecord): void {
  const file = asksPathBeside(logPath);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/** The stored updates. A missing or unreadable file holds none. */
export function readAllow(logPath: string): Update[] {
  try {
    const data = JSON.parse(readFileSync(allowPathBeside(logPath), "utf8"));
    return Array.isArray(data?.updates) ? data.updates : [];
  } catch {
    return [];
  }
}

/** Adds updates to the stored ones. An update that is stored already is not added twice. */
export function keepAllow(logPath: string, added: readonly Update[]): void {
  const have = readAllow(logPath);
  const seen = new Set(have.map((u) => JSON.stringify(u)));
  const next = [...have];
  for (const update of added) {
    if (!seen.has(JSON.stringify(update))) next.push(update);
  }
  const file = allowPathBeside(logPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ updates: next }, null, 2)}\n`);
}
