/** The path from the root to the open card, and how much of it fits one line (#vi-crumbs, #vi-crumbs-line). */

export type Crumb = { id: string; title: string };

type Row = { id: string; title: string; parent: string | null };

/** The pane width from which a third segment shows. */
export const WIDE_PANE = 700;

/** The cards from the root down to the card, each refining the one before it. Empty when the map lacks the card. */
export function pathTo(rows: readonly Row[], id: string | null): Crumb[] {
  if (id === null) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: Crumb[] = [];
  const seen = new Set<string>();
  for (
    let row = byId.get(id);
    row !== undefined && !seen.has(row.id);
    row = row.parent === null ? undefined : byId.get(row.parent)
  ) {
    seen.add(row.id);
    path.unshift({ id: row.id, title: row.title });
  }
  return path;
}

export type Line = {
  /** The segments that show, root side first. The last one is the open card. */
  shown: Crumb[];
  /** Whether a `…` stands in for hidden ancestors. */
  cut: boolean;
  /** Whether hover opens the whole path: a path of two segments or fewer hides nothing. */
  overlay: boolean;
};

/** The last two segments, and a third when the left pane is wide. */
export function lineOf(path: readonly Crumb[], paneWidth: number): Line {
  const room = paneWidth >= WIDE_PANE ? 3 : 2;
  return {
    shown: path.slice(-room),
    cut: path.length > room,
    overlay: path.length > 2,
  };
}
