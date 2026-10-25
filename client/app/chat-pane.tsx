import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SearchRow } from "../lib/card-search";
import type { ChatStore } from "../lib/chat-store";
import { AskBar } from "./ask-bar";
import { ChatHead } from "./chat-head";
import { ChatLog } from "./chat-log";
import { NextOffer, StatusLines } from "./chat-notes";
import { Composer } from "./composer";

/** The right pane: the log, the header row, then the composer (#werk-head-bottom). */
export function ChatPane({
  store,
  cards,
}: {
  store: ChatStore;
  cards: () => readonly SearchRow[];
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
        <ChatLog state={state} />
        <NextOffer state={state} store={store} />
      </div>
      <StatusLines state={state} />
      <AskBar state={state} store={store} />
      <ChatHead state={state} store={store} />
      <Composer
        images={store}
        menu={{ commands: store.commands, cards }}
        onSend={(text, images) => void store.send(text, images)}
      />
    </div>
  );
}
