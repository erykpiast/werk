/** From the changes to cited cards to the board events that mark the open tickets that cite them (#st-ticket-watch). Pure. */
import type { CitedChange } from "../plan/cited-changes.ts";
import { type Board, isOpen } from "./fold.ts";

export type MarkEvent = {
  type: "ticket.marked";
  id: string;
  card: string;
  kind: string;
  version: number;
};

/** The cards that the open tickets cite: the cards whose changes the watcher reads. */
export function watchedCards(board: Board): Set<string> {
  const cards = new Set<string>();
  for (const ticket of board.tickets.values()) {
    if (!isOpen(ticket)) continue;
    for (const card of Object.keys(ticket.cited)) cards.add(card);
  }
  return cards;
}

/**
 * One event for each open ticket and cited card that changed after the ticket's recorded version.
 * A card whose change the ticket already carries gets no second event, so a rerun appends nothing.
 */
export function markEvents(
  board: Board,
  changes: readonly CitedChange[],
): MarkEvent[] {
  const events: MarkEvent[] = [];
  for (const ticket of board.tickets.values()) {
    if (!isOpen(ticket)) continue;
    for (const [card, recorded] of Object.entries(ticket.cited)) {
      const newer = changes.filter((c) => c.card === card && c.line > recorded);
      if (newer.length === 0) continue;
      const version = Math.max(...newer.map((c) => c.line));
      const carried = ticket.marks.some(
        (m) => m.card === card && m.version >= version,
      );
      if (carried) continue;
      const kinds = [...new Set(newer.map((c) => c.kind))];
      events.push({
        type: "ticket.marked",
        id: ticket.id,
        card,
        kind: kinds.join(", "),
        version,
      });
    }
  }
  return events;
}
