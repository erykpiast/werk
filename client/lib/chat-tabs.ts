/**
 * The tabs of the conversations, as the tab strip and the panes read them. A tab whose agent exited
 * without werk stopping it is dead until its next agent starts (#werk-mc-live-dead). A dead tab blinks
 * red on its chip (#werk-mc-asks-dot) and shows a line in every other pane (#werk-mc-live-line). Its own
 * pane shows the whole error (#werk-fullerr).
 */
import type { ChatState } from "./chat-log";

export type TabsState = {
  /** The tabs in the order they were opened. */
  order: string[];
  chats: Record<string, ChatState>;
  /** The tab whose pane is shown. */
  current: string;
};

/** One line about a dead tab, for the pane of another tab. */
export type DeadLine = { tab: string; line: string };

const firstLine = (error: string) =>
  error
    .split("\n")
    .find((l) => l.trim() !== "")
    ?.trim() ?? error;

/** The lines that the pane of the shown tab carries: one for each other tab that is dead. */
export function deadLinesOf(state: TabsState): DeadLine[] {
  return state.order
    .filter((tab) => tab !== state.current)
    .flatMap((tab) => {
      const error = state.chats[tab]?.dead ?? null;
      return error === null ? [] : [{ tab, line: firstLine(error) }];
    });
}

/** The whole error of the shown tab, or null while its agent lives. */
export function ownErrorOf(state: TabsState): string | null {
  return state.chats[state.current]?.dead ?? null;
}

export type Chip = { tab: string; current: boolean; blink: "red" | null };

/** The chips of the tab strip. A dead tab blinks red, also when it is the shown one. */
export function chipsOf(state: TabsState): Chip[] {
  return state.order.map((tab) => ({
    tab,
    current: tab === state.current,
    blink: state.chats[tab]?.dead != null ? "red" : null,
  }));
}

/** A name for a new tab that no open tab has. */
export function nextTabName(order: readonly string[]): string {
  let n = order.length + 1;
  while (order.includes(String(n))) n += 1;
  return String(n);
}
