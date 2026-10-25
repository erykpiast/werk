import { Button } from "../components/ui/button";
import type { ChatState } from "../lib/chat-log";
import type { ChatStore } from "../lib/chat-store";
import { offerOf } from "../lib/next-offer";

/** The button of the suggested next action. A click sends its phrase and leaves the draft alone (#werk-mc-nextbtn). */
export function NextOffer({
  state,
  store,
}: {
  state: ChatState;
  store: ChatStore;
}) {
  const phrase = offerOf(state);
  if (phrase === null) return null;
  return (
    <div data-slot="next-offer">
      <Button onClick={() => void store.send(phrase)}>{phrase}</Button>
    </div>
  );
}

/**
 * The line under the chat log while a background agent runs (#werk-mc-bg-line).
 */
export function StatusLines({ state }: { state: ChatState }) {
  return (
    <>
      {state.background > 0 ? (
        <div data-slot="background-line">
          ○ A background agent runs
          {state.background > 1 ? ` (${state.background} tasks)` : ""}
        </div>
      ) : null}
    </>
  );
}
