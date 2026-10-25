/**
 * The page's one live channel. Every connect reads the open card again, and so does every bare
 * change signal: the page never patches what it shows (#werk-write-changed, #werk-write-watch-start).
 * The server renders the card, and the page swaps its HTML in (#werk-stack-hydration).
 * A reload signal stashes the composer draft and reloads the page (#werk-client-reload).
 */

import type { SearchRow } from "./card-search";
import { CHAT_EVENTS } from "./chat-store";
import type { CountRollup } from "./counts";
import { apiOf } from "./project-route";

/** What the server renders for the open card. The id is null for an empty map. */
export type OpenView = { id: string | null; html?: string };

/** What the header reads: one row per node and the counts of each card (#vi-jump, #vi-counts-header). */
export type HeaderIndex = {
  entries: (SearchRow & { parent: string | null })[];
  rollups: Record<string, CountRollup>;
};

type Source = {
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void;
  close(): void;
};

export type MapStoreDeps = {
  fetch: (url: string) => Promise<Response>;
  connect: (url: string) => Source;
  /** Puts the server's HTML for the open card on the page. */
  show: (view: OpenView) => void;
  /** Called with the header's index each time the open card is read, when given. */
  index?: (index: HeaderIndex) => void;
  reload: () => void;
  stashDraft: () => void;
  /** The chat parts that the live channel carries, with their JSON data (#werk-progress). */
  chat?: (type: string, data: string) => void;
  /** Called each time the channel connects, so the chat can read what it missed. */
  connected?: () => void;
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
      const [res, indexRes] = await Promise.all([
        deps.fetch(
          apiOf(
            project,
            card === null ? "/open" : `/open?card=${encodeURIComponent(card)}`,
          ),
        ),
        deps.index ? deps.fetch(apiOf(project, "/index")) : null,
      ]);
      if (!res.ok) return;
      const view = (await res.json()) as OpenView;
      const index =
        indexRes?.ok === true ? ((await indexRes.json()) as HeaderIndex) : null;
      if (mine !== latest) return;
      if (index) deps.index?.(index);
      deps.show(view);
    } catch {
      // The next connect or signal reads again.
    }
  };

  return {
    start() {
      if (source) return;
      source = deps.connect(apiOf(project, "/live"));
      source.addEventListener("open", () => {
        void refresh();
        deps.connected?.();
      });
      for (const type of CHAT_EVENTS) {
        source.addEventListener(type, (event) =>
          deps.chat?.(type, String(event.data ?? "")),
        );
      }
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
