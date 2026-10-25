/** The text of a thread of notes and of the inbox. See #werk-propose-new-discard-thread and #werk-cli-notes. */
import type { FoldedMap, ThreadEntry } from "./fold.ts";

const MARKER = "-- proposed again --";

function entryText(entry: ThreadEntry): string {
  return entry.kind === "note" ? `${entry.by}: ${entry.text}` : MARKER;
}

/** The lines that a card prints for its thread, in the order they were written. */
export function threadLines(entries: readonly ThreadEntry[]): string[] {
  return entries.map((entry) => `  ${entryText(entry)}`);
}

/**
 * The entries of every thread after one log position, oldest first, at most `count`.
 * A thread that outlives its card is listed too.
 */
export function inboxLines(
  map: FoldedMap,
  since: number,
  count: number,
): string[] {
  const rows: { line: number; id: string; entry: ThreadEntry }[] = [];
  for (const [id, entries] of map.threads) {
    for (const entry of entries) {
      if (entry.line > since) rows.push({ line: entry.line, id, entry });
    }
  }
  rows.sort((a, b) => a.line - b.line);
  return rows
    .slice(0, count)
    .map(({ line, id, entry }) => `${line}  ${id}  ${entryText(entry)}`);
}
