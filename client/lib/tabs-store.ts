/**
 * The conversations of a page: one chat store for each tab. A part of the live channel goes to the
 * store of the tab it names, so a reply streams into its tab while another tab is shown. A part that
 * names no tab belongs to the main conversation (#werk-mc-live-dead).
 */
import type { ChatState } from "./chat-log";
import {
  type ChatDeps,
  type ChatStore,
  createChatStore,
  MAIN_TAB,
} from "./chat-store";
import { nextTabName, type TabsState } from "./chat-tabs";
import { apiOf } from "./project-route";

export type TabsStore = {
  get(): TabsState;
  subscribe(listener: () => void): () => void;
  /** The chat store of the tab whose pane is shown. */
  current(): ChatStore;
  /** Applies one event of the live channel to the tab it names. */
  receive(type: string, data: string): void;
  /** Reads the tabs and the events that the server kept, for a page that joins late. */
  load(): Promise<void>;
  select(tab: string): void;
  /** Opens a new tab, shows it, and tells the server about it. */
  open(): void;
};

export function createTabsStore(deps: ChatDeps, project: string): TabsStore {
  const stores = new Map<string, ChatStore>();
  const listeners = new Set<() => void>();
  let order: string[] = [];
  let current = MAIN_TAB;
  let snapshot: TabsState;

  const refresh = () => {
    snapshot = {
      order,
      current,
      chats: Object.fromEntries(
        order.map((tab) => [tab, (stores.get(tab) as ChatStore).get()]),
      ) as Record<string, ChatState>,
    };
    for (const listener of listeners) listener();
  };

  const storeOf = (tab: string): ChatStore => {
    const have = stores.get(tab);
    if (have) return have;
    const made = createChatStore(deps, project, tab);
    stores.set(tab, made);
    order = [...order, tab];
    made.subscribe(refresh);
    return made;
  };

  storeOf(MAIN_TAB);
  refresh();

  const tabOfData = (data: string): string => {
    try {
      const tab = (JSON.parse(data) as { tab?: unknown }).tab;
      return typeof tab === "string" ? tab : MAIN_TAB;
    } catch {
      return MAIN_TAB;
    }
  };

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current: () => storeOf(current),
    receive(type, data) {
      storeOf(tabOfData(data)).receive(type, data);
      refresh();
    },
    async load() {
      try {
        const res = await deps.fetch(apiOf(project, "/tabs"));
        if (res.ok) {
          const { tabs } = (await res.json()) as { tabs?: unknown };
          if (Array.isArray(tabs)) {
            for (const tab of tabs) if (typeof tab === "string") storeOf(tab);
          }
        }
      } catch {
        // The main conversation still loads.
      }
      refresh();
      await Promise.all([...stores.values()].map((s) => s.load()));
    },
    select(tab) {
      if (!stores.has(tab) || tab === current) return;
      current = tab;
      refresh();
    },
    open() {
      const tab = nextTabName(order);
      const store = storeOf(tab);
      current = tab;
      refresh();
      void store.load();
    },
  };
}
