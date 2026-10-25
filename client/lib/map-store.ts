/**
 * The page's one live channel. Every connect reads the open card again, and so does every bare
 * change signal: the page never patches what it shows (#werk-write-changed, #werk-write-watch-start).
 * The server renders the card, and the page swaps its HTML in (#werk-stack-hydration).
 * A reload signal stashes the composer draft and reloads the page (#werk-client-reload).
 */

import { apiOf } from "./project-route";

/** What the server renders for the open card. The id is null for an empty map. */
export type OpenView = { id: string | null; html?: string };

type Source = {
  addEventListener(type: string, listener: () => void): void;
  close(): void;
};

export type MapStoreDeps = {
  fetch: (url: string) => Promise<Response>;
  connect: (url: string) => Source;
  /** Puts the server's HTML for the open card on the page. */
  show: (view: OpenView) => void;
  reload: () => void;
  stashDraft: () => void;
};

export type MapStore = {
  start(): void;
  /** Opens the page of this card, or the open card of the map for null (#vi-onview). */
  open(card: string | null): void;
  stop(): void;
};

/** The store of one project. Every route it reads names the project (#werk-projects). */
export function createMapStore(deps: MapStoreDeps, project: string): MapStore {
  let source: Source | undefined;
  let latest = 0;
  let card: string | null = null;

  /** Reads the open card again. A read that a later read overtakes is dropped. */
  const refresh = async () => {
    const mine = ++latest;
    try {
      const res = await deps.fetch(
        apiOf(
          project,
          card === null ? "/open" : `/open?card=${encodeURIComponent(card)}`,
        ),
      );
      if (!res.ok) return;
      const view = (await res.json()) as OpenView;
      if (mine === latest) deps.show(view);
    } catch {
      // The next connect or signal reads again.
    }
  };

  return {
    start() {
      if (source) return;
      source = deps.connect(apiOf(project, "/live"));
      source.addEventListener("open", () => void refresh());
      source.addEventListener("changed", () => void refresh());
      source.addEventListener("reload", () => {
        deps.stashDraft();
        deps.reload();
      });
    },
    open(next) {
      card = next;
      void refresh();
    },
    stop() {
      source?.close();
      source = undefined;
    },
  };
}
