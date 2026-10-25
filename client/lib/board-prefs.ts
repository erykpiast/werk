/**
 * The two drawer toggles: the sidebar folded to a rail, and the log that hides the sidebar and
 * doubles its height. Each choice is kept across redraws and page loads (#vi-board-details).
 */

export type BoardPrefs = { sidebarFolded: boolean; logExpanded: boolean };

type Store = Pick<Storage, "getItem" | "setItem">;

const key = (project: string) => `werk.board.${project}`;

const DEFAULTS: BoardPrefs = { sidebarFolded: false, logExpanded: false };

/** The choices of the project. A value that is missing or damaged gives the defaults. */
export function readPrefs(storage: Store, project: string): BoardPrefs {
  try {
    const value = JSON.parse(storage.getItem(key(project)) ?? "null");
    if (value === null || typeof value !== "object") return DEFAULTS;
    return {
      sidebarFolded: value.sidebarFolded === true,
      logExpanded: value.logExpanded === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function writePrefs(
  storage: Store,
  project: string,
  prefs: BoardPrefs,
): void {
  storage.setItem(key(project), JSON.stringify(prefs));
}

/** The sidebar is hidden while the log is expanded, and a rail while it is folded. */
export function sidebarMode(prefs: BoardPrefs): "hidden" | "rail" | "full" {
  if (prefs.logExpanded) return "hidden";
  return prefs.sidebarFolded ? "rail" : "full";
}
