// The text of a card's thread and of the inbox (#werk-cli-notes). A thread belongs to the id, and
// a marker in it shows where the id was proposed again (#werk-propose-new-discard-thread).
import type { FoldedMap, ThreadEntry } from "./types.ts";

type Note = Extract<ThreadEntry, { kind: "note" }>;

/** The label of an inbox note that a "proposed again" marker follows (#werk-propose-new-discard-thread-inbox). */
export const EARLIER_WORDS = "(on earlier words, proposed again since)";

const indent = (text: string) => text.replace(/\n/g, "\n    ");

/** The thread lines of `werk show`: each note with its log position and writer, and each marker. */
export function formatThread(entries: ThreadEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines = entries.map((entry) =>
    entry.kind === "note"
      ? `  [${entry.seq}] ${entry.actor}: ${indent(entry.text)}`
      : `  [${entry.seq}] --- proposed again: the notes above were about the earlier words ---`,
  );
  return ["Thread", ...lines];
}

export type InboxQuery = { since: number; count: number };

/**
 * The notes the person typed in the map, in log order, after log position `since` and at most
 * `count` of them. Each prints under the title its id has now, with a label when the id was
 * proposed again after it.
 */
export function formatInbox(map: FoldedMap, { since, count }: InboxQuery): string {
  const notes: { id: string; note: Note; earlier: boolean }[] = [];
  for (const [id, entries] of map.threads) {
    entries.forEach((entry, index) => {
      if (entry.kind !== "note" || entry.actor !== "you" || entry.seq <= since) return;
      const earlier = entries.slice(index + 1).some((later) => later.kind === "proposed again");
      notes.push({ id, note: entry, earlier });
    });
  }
  notes.sort((a, b) => a.note.seq - b.note.seq);
  return notes
    .slice(0, count)
    .map(({ id, note, earlier }) => {
      const title = map.nodes.get(id)?.title;
      const head = [
        `[${note.seq}] #${id}`,
        ...(title === undefined ? [] : [title]),
        ...(earlier ? [EARLIER_WORDS] : []),
      ];
      return `${head.join("  ")}\n    ${indent(note.text)}\n`;
    })
    .join("");
}
