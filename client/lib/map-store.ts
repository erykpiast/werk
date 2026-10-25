/**
 * The page's one live channel and its one copy of the map. Every connect reads the whole map, and so
 * does every bare change signal: the page never patches its copy (#werk-write-changed, #werk-write-watch-start).
 * A reload signal stashes the composer draft and reloads the page (#werk-client-reload).
 */
import { openCardId, type ShapeLike, subCardIds } from "./scope";

export type CardView = {
  id: string;
  title: string;
  why: string;
  body: string;
  status: string;
  proposed: boolean;
};

export type MapState = {
  connection: "connecting" | "live" | "down";
  /** False until the first read finishes. */
  loaded: boolean;
  open: CardView | null;
  subCards: CardView[];
};

type Source = {
  addEventListener(type: string, listener: () => void): void;
  close(): void;
};

export type MapStoreDeps = {
  fetch: (url: string) => Promise<Response>;
  connect: (url: string) => Source;
  reload: () => void;
  stashDraft: () => void;
};

export type MapStore = {
  getState(): MapState;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
};

async function readJson<T>(
  fetcher: MapStoreDeps["fetch"],
  url: string,
): Promise<T> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function createMapStore(deps: MapStoreDeps): MapStore {
  let state: MapState = {
    connection: "connecting",
    loaded: false,
    open: null,
    subCards: [],
  };
  const listeners = new Set<() => void>();
  let source: Source | undefined;
  let latest = 0;

  const set = (next: Partial<MapState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const readCard = async (id: string): Promise<CardView | null> => {
    const read = await readJson<{ found: boolean; card?: CardView }>(
      deps.fetch,
      `/api/card/${encodeURIComponent(id)}`,
    );
    return read.found && read.card ? read.card : null;
  };

  /** Reads the whole map again. A read that a later read overtakes is dropped. */
  const refresh = async () => {
    const mine = ++latest;
    try {
      const shape = await readJson<ShapeLike>(deps.fetch, "/api/graph?shape=1");
      const id = openCardId(shape);
      const open = id === null ? null : await readCard(id);
      const subCards =
        id === null
          ? []
          : (await Promise.all(subCardIds(shape, id).map(readCard))).filter(
              (card): card is CardView => card !== null,
            );
      if (mine === latest) set({ loaded: true, open, subCards });
    } catch {
      // The next connect or signal reads again.
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (source) return;
      source = deps.connect("/api/live");
      source.addEventListener("open", () => {
        set({ connection: "live" });
        void refresh();
      });
      source.addEventListener("changed", () => void refresh());
      source.addEventListener("reload", () => {
        deps.stashDraft();
        deps.reload();
      });
      source.addEventListener("error", () => set({ connection: "down" }));
    },
    stop() {
      source?.close();
      source = undefined;
    },
  };
}
