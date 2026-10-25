/**
 * What the chat does when its agent exits before it ends the turn: replay into a new session, retry
 * once, or report and stop (#werk-resume, #werk-crashmsg, #werk-fullerr).
 */

/** The words of Claude Code's own message for a stored session id that no longer resolves. */
const NO_CONVERSATION = "No conversation found with session ID";

/** Failures that fail the same way a second time: a missing login, a bad flag, a missing credential. */
const FATAL = [
  /claude auth login/i,
  /\/login\b/i,
  /not logged in/i,
  /invalid api key/i,
  /authentication[_ ](error|failed)/i,
  /credential/i,
  /error: option .* (is invalid|argument missing)/i,
  /error: unknown option/i,
  /error: (missing required argument|too many arguments)/i,
];

export type CrashAction =
  | { kind: "replay" }
  | { kind: "retry" }
  | { kind: "report"; message: string };

/** True when Claude Code says the stored session id names no conversation. */
export function isDeadSession(text: string): boolean {
  return text.includes(NO_CONVERSATION);
}

/** True when a retry cannot fix the failure. */
export function isFatal(text: string): boolean {
  return FATAL.some((pattern) => pattern.test(text));
}

/**
 * The action for one exit of the agent. Only the dead-session message clears the stored id, and
 * only while an id is stored, so a fresh session that fails the same way is reported and not replayed
 * again. The report carries the whole error text.
 */
export function onCrash(
  text: string,
  state: { hasSession: boolean; retried: boolean },
): CrashAction {
  if (state.hasSession && isDeadSession(text)) return { kind: "replay" };
  if (isFatal(text)) {
    return {
      kind: "report",
      message: `${text}\n\nFix the problem above, then send it again.`,
    };
  }
  if (!state.retried) return { kind: "retry" };
  return {
    kind: "report",
    message: `${text}\n\nYour message was not delivered. Send it again.`,
  };
}
