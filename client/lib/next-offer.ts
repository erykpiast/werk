/**
 * The suggested next action of a reply, shown as a button (#werk-mc-nextbtn). The agent ends a
 * reply with a line `Next: say "<phrase>"` or `Next: reply "<phrase>"`.
 */
import type { ChatState } from "./chat-log";

const NEXT_LINE = /^[*_\s]*Next:[*_\s]*(?:say|reply)\s+["“”]([^"“”]+)["“”]/i;

/** The phrase of a message whose last line offers one, or null. Text after the closing quote is ignored. */
export function nextPhrase(text: string): string | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1];
  const phrase = last?.match(NEXT_LINE)?.[1]?.trim();
  return phrase === undefined || phrase === "" ? null : phrase;
}

/**
 * The offer that a click can send: the phrase of the last message of the newest turn, once that turn
 * ended without an error. Any later message ends the offer, so only the latest is ever clickable.
 */
export function offerOf(state: ChatState): string | null {
  const turn = state.turns[state.turns.length - 1];
  if (!turn || turn.end === null || turn.end.error) return null;
  const texts = turn.items.filter((i) => i.kind === "text" && !i.streaming);
  const last = texts[texts.length - 1];
  return last ? nextPhrase(last.text) : null;
}
