import { useEffect, useState } from "react";
import { type ChatState, formatTokens, headOf } from "../lib/chat-log";

/**
 * The chat header row: the turn state, with a pulse, what the agent does, seconds and tokens
 * (#werk-progress). It sits directly above the composer (#werk-head-bottom).
 */
export function ChatHead({ state }: { state: ChatState }) {
  const [now, setNow] = useState(() => Date.now());
  const busy = headOf(state, now).busy;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const head = headOf(state, now);
  return (
    <div data-slot="chat-head" data-busy={head.busy || undefined}>
      <span data-slot="pulse" aria-hidden="true" />
      <span data-slot="chat-state">{head.label}</span>
      {head.seconds === null ? null : <span>{head.seconds}s</span>}
      {head.tokens === null ? null : <span>{formatTokens(head.tokens)}</span>}
    </div>
  );
}
