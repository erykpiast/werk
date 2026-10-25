import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SearchRow } from "../lib/card-search";
import type { ChatStore } from "../lib/chat-store";
import {
  chipsOf,
  deadLinesOf,
  ownErrorOf,
  type TabsState,
} from "../lib/chat-tabs";
import { AskBar } from "./ask-bar";
import { ChatHead } from "./chat-head";
import { ChatLog } from "./chat-log";
import { NextOffer, StatusLines } from "./chat-notes";
import { Composer } from "./composer";
import { DeadLines, OwnError, TabStrip } from "./tab-strip";

/** The right pane: the log, the header row, then the composer (#werk-head-bottom). */
export function ChatPane({
  store,
  cards,
  tabs,
  onSelect,
  onOpen,
}: {
  store: ChatStore;
  cards: () => readonly SearchRow[];
  /** The tabs of the conversations. Without them the pane shows one conversation and no strip. */
  tabs?: TabsState;
  onSelect?: (tab: string) => void;
  onOpen?: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const log = useRef<HTMLDivElement>(null);
  // A new part of the reply keeps the end of the log in sight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each change of the state
  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [state]);
  return (
    <div data-slot="chat-pane">
      <div ref={log} data-slot="chat-scroll">
        <ChatLog state={state} imageUrl={store.imageUrl} />
        <NextOffer state={state} store={store} />
      </div>
      <StatusLines state={state} />
      {tabs ? <DeadLines lines={deadLinesOf(tabs)} /> : null}
      {tabs ? <OwnError error={ownErrorOf(tabs)} /> : null}
      <AskBar state={state} store={store} />
      <ChatHead state={state} store={store} />
      <Composer
        images={store}
        menu={{ commands: store.commands, cards }}
        onSend={(text, images) => void store.send(text, images)}
      />
      {tabs && onSelect && onOpen ? (
        <TabStrip chips={chipsOf(tabs)} onSelect={onSelect} onOpen={onOpen} />
      ) : null}
    </div>
  );
}
