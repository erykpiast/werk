/** The search of the header box: which nodes match, in what order, and the color of each row's dot (#vi-jump, #vi-jump-hash, #vi-jump-row). */

export type SearchRow = {
  id: string;
  kind: string;
  title: string;
  why: string;
  status: "open" | "proto" | "decided" | null;
  stale: boolean;
  postponed: boolean;
};

/** The most rows the list shows. */
export const LIMIT = 12;

/** The rows that match the typed text. A leading # compares ids only, the exact id first, then prefix, then contains. */
export function search(rows: readonly SearchRow[], typed: string): SearchRow[] {
  const query = typed.trim().toLowerCase();
  if (query === "" || query === "#") return [];
  if (!query.startsWith("#")) {
    return rows
      .filter(
        (row) =>
          row.id.toLowerCase().includes(query) ||
          row.title.toLowerCase().includes(query) ||
          row.why.toLowerCase().includes(query),
      )
      .slice(0, LIMIT);
  }
  const id = query.slice(1);
  const rank = (row: SearchRow): number => {
    const own = row.id.toLowerCase();
    if (own === id) return 0;
    if (own.startsWith(id)) return 1;
    return own.includes(id) ? 2 : 3;
  };
  return rows
    .map((row) => ({ row, rank: rank(row) }))
    .filter((hit) => hit.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, LIMIT)
    .map((hit) => hit.row);
}

export type Dot = {
  color:
    | "decided"
    | "open"
    | "proto"
    | "stale"
    | "option"
    | "source"
    | "excerpt";
  /** A postponed card: the lower-right half is grey. */
  split: boolean;
};

/** The dot of a row: red when stale, else the status color, split when postponed. A node with no status takes its kind's color. */
export function dotOf(row: SearchRow): Dot {
  if (row.status === null) {
    return { color: row.kind as "option" | "source" | "excerpt", split: false };
  }
  if (row.stale) return { color: "stale", split: false };
  return { color: row.status, split: row.postponed };
}
