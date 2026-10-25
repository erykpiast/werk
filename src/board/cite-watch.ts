/**
 * The watcher of cited cards (#st-ticket-watch). It reads the decision log and the board, marks every open ticket
 * whose cited card changed, and reports the cards-cited check of each planned subtree again. A program, not a model:
 * the same logs always give the same events, and a rerun with no new change appends nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLog } from "../map/fold.ts";
import { readMap } from "../map/log-store.ts";
import { citedChanges } from "../plan/cited-changes.ts";
import { decidedUnder } from "../tickets/decided-cards.ts";
import { ownChecks } from "../tickets/own-checks.ts";
import { readTicketFiles } from "../tickets/read-folder.ts";
import { uncitedCards } from "../tickets/set-checks.ts";
import { parseTicket, ticketNumber } from "../tickets/ticket-parse.ts";
import { markEvents, watchedCards } from "./cite-marks.ts";
import { type Board, isOpen } from "./fold.ts";
import { appendBoardEvent, boardLogBeside, readBoard } from "./log-store.ts";

/** The decided cards of a planned subtree that no open ticket's file cites, from the files in the store. */
function uncitedOf(
  store: string,
  board: Board,
  root: string,
  decided: string[],
) {
  const plan = board.plans.get(root);
  const numbers = new Set(
    (plan?.tickets ?? [])
      .map((id) => board.tickets.get(id))
      .filter((t) => t !== undefined && !t.archived)
      .map((t) => Number(t?.number)),
  );
  const dir = join(store, "tickets", root);
  if (!existsSync(dir)) return decided;
  const passed = readTicketFiles(dir)
    .filter((f) => numbers.has(Number(ticketNumber(f.name))))
    .flatMap((f) => {
      const ticket = parseTicket(f.name, f.text);
      return ticket && ownChecks(ticket).length === 0 ? [ticket] : [];
    });
  return uncitedCards(passed, decided);
}

const hasOpenTicket = (board: Board, root: string): boolean =>
  (board.plans.get(root)?.tickets ?? []).some((id) => {
    const ticket = board.tickets.get(id);
    return ticket !== undefined && isOpen(ticket);
  });

/** Runs the watcher once over the project whose map log is given. Returns the number of board events appended. */
export function runCiteWatch(logPath: string): number {
  const boardLog = boardLogBeside(logPath);
  const board = readBoard(boardLog);
  if (board.tickets.size === 0) return 0;
  const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  let appended = 0;

  const watched = watchedCards(board);
  const marks = markEvents(board, citedChanges(parseLog(text), watched));
  for (const event of marks) {
    if (appendBoardEvent(boardLog, event).ok) appended += 1;
  }

  const { map } = readMap(logPath);
  for (const [root, plan] of board.plans) {
    if (!hasOpenTicket(board, root)) continue;
    const uncited = uncitedOf(
      dirname(logPath),
      board,
      root,
      decidedUnder(map, root),
    );
    const same =
      uncited.length === plan.uncited.length &&
      uncited.every((id, i) => id === plan.uncited[i]);
    if (same) continue;
    const result = appendBoardEvent(boardLog, {
      type: "plan.cards_checked",
      plan: root,
      uncited,
    });
    if (result.ok) appended += 1;
  }
  return appended;
}
