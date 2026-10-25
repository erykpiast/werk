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
 * The lines under the chat log: the background agent while one runs, then the error of a dead agent
 * (#werk-mc-bg-line, #werk-mc-live-dead).
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
      {state.dead === null ? null : (
        <div data-slot="dead-bar" role="alert">
          The agent died: {state.dead}
        </div>
      )}
    </>
  );
}
