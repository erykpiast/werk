/** What the approval bar shows of a call and of a question form (#werk-approve-bar, #werk-mc-askqa). */
import type { PendingAsk } from "./chat-log";

/** The call as one block of text: a command as it is, any other input as JSON. */
export function callText(ask: Pick<PendingAsk, "tool" | "input">): string {
  const command =
    typeof ask.input === "object" && ask.input !== null
      ? (ask.input as Record<string, unknown>).command
      : undefined;
  return typeof command === "string"
    ? command
    : JSON.stringify(ask.input, null, 2);
}

/** The letter of the option at this place: A, B, C. */
export const letter = (index: number): string =>
  String.fromCharCode(65 + index);
