import { useSyncExternalStore } from "react";
import type { SearchRow } from "../lib/card-search";
import type { TabsStore } from "../lib/tabs-store";
import { ChatPane } from "./chat-pane";

/** The chat pane of the shown tab, with the strip of tabs under its composer (#werk-mc-tabs). */
export function TabbedChat({
  tabs,
  cards,
}: {
  tabs: TabsStore;
  cards: () => readonly SearchRow[];
}) {
  const state = useSyncExternalStore(tabs.subscribe, tabs.get);
  return (
    <ChatPane
      key={state.current}
      store={tabs.current()}
      cards={cards}
      tabs={state}
      onSelect={tabs.select}
      onOpen={tabs.open}
    />
  );
}
