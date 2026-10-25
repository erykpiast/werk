/**
 * The board's reads. The page reads the whole board again on each board signal of the live channel,
 * and on a slow poll, because a builder that dies writes nothing to the board log
 * (#vi-board-redraw-signal). The log of the open building ticket is read on the same beat.
 */
import type { LogLine } from "../../src/board/session-log";
import type { BoardView } from "../../src/board/view";
import { apiOf } from "./project-route";

export type BoardState = {
  board: BoardView | null;
  /** The log lines of the open ticket, or null when none is read. */
  lines: LogLine[] | null;
};

export type BoardStoreDeps = {
  fetch: (url: string) => Promise<Response>;
  /** The ticket whose drawer is open and has a live log, or null. */
  logTicket: () => string | null;
  show: (state: BoardState) => void;
  /** Calls the function every few seconds and gives the way to stop. */
  every: (ms: number, run: () => void) => () => void;
};

/** How often the board is read again with no signal, in milliseconds. */
export const POLL_MS = 4000;

export type BoardStore = {
  /** Reads the board and the log now. */
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
};

export function createBoardStore(
  deps: BoardStoreDeps,
  project: string,
): BoardStore {
  let latest = 0;
  let stopPoll: (() => void) | undefined;
  const refresh = async () => {
    const mine = ++latest;
    try {
      const ticket = deps.logTicket();
      const [boardRes, logRes] = await Promise.all([
        deps.fetch(apiOf(project, "/board")),
        ticket === null
          ? null
          : deps.fetch(
              apiOf(project, `/board/log?ticket=${encodeURIComponent(ticket)}`),
            ),
      ]);
      if (!boardRes.ok) return;
      const board = (await boardRes.json()) as BoardView;
      const lines =
        logRes?.ok === true
          ? ((await logRes.json()) as { lines: LogLine[] }).lines
          : null;
      if (mine !== latest) return;
      deps.show({ board, lines });
    } catch {
      // The next signal or poll reads again.
    }
  };
  return {
    refresh,
    start() {
      stopPoll ??= deps.every(POLL_MS, () => void refresh());
      void refresh();
    },
    stop() {
      stopPoll?.();
      stopPoll = undefined;
      latest++;
    },
  };
}
