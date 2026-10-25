/** Each project remembers the view in use and the card last open on the map, so a bare project address opens them again (#vi-tabs). */
import type { View } from "./project-route";

export type Remembered = { view: View; card: string | null };

type Store = Pick<Storage, "getItem" | "setItem">;

const key = (project: string) => `werk.view.${project}`;

/** What the project remembers: the map at the root when it remembers nothing, or when the stored value is damaged. */
export function recall(storage: Store, project: string): Remembered {
  const fallback: Remembered = { view: "map", card: null };
  try {
    const value = JSON.parse(storage.getItem(key(project)) ?? "null");
    if (value === null || typeof value !== "object") return fallback;
    const view = value.view === "board" ? "board" : "map";
    const card = typeof value.card === "string" ? value.card : null;
    return { view, card };
  } catch {
    return fallback;
  }
}

/** Notes where the person is. A view other than the map keeps the last map card. */
export function remember(
  storage: Store,
  project: string,
  now: { view: View; card: string | null },
): void {
  const before = recall(storage, project);
  const next: Remembered = {
    view: now.view,
    card: now.view === "map" ? now.card : before.card,
  };
  storage.setItem(key(project), JSON.stringify(next));
}
