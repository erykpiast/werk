import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ChatStore } from "../lib/chat-store";
import { AskBar } from "./ask-bar";
import { ChatHead } from "./chat-head";
import { ChatLog } from "./chat-log";
import { Composer } from "./composer";

/** The right pane: the log, the header row, then the composer (#werk-head-bottom). */
export function ChatPane({ store }: { store: ChatStore }) {
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
      </div>
      <AskBar state={state} store={store} />
      <ChatHead state={state} />
      <Composer
        images={store}
        onSend={(text, images) => void store.send(text, images)}
      />
    </div>
  );
}
