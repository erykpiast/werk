/** From the files a plan wrote and their verdict to the tickets that go on the board (#st-ticket-partial). Pure. */
import type { Verdict } from "../tickets/check-folder.ts";
import { SET } from "../tickets/set-checks.ts";
import {
  listOf,
  normalizeNumber,
  parseTicket,
  ticketNumber,
} from "../tickets/ticket-parse.ts";

export type PlannedTicket = {
  /** A ticket the board does not hold is planned. An open one is replanned in place (#st-plan-extend). */
  type: "ticket.planned" | "ticket.replanned";
  id: string;
  title: string;
  blocked_by: string[];
  /** The version of each cited card, as the plan read it (#st-ticket-watch). */
  cited: Record<string, number>;
  /** Present when a failed set check names the ticket. The ticket then starts in blocked. */
  reason?: string;
};

/** The numbers of the plan's tickets that are already on the board, and which of them are open. */
export type OnBoard = {
  numbers: ReadonlySet<number>;
  open: ReadonlySet<number>;
};

export type TicketPlan = {
  planned: PlannedTicket[];
  /** Files that get no planned event for a reason that the checks do not report. */
  unplanned: string[];
};

const idOf = (planId: string, number: number): string =>
  `${planId}/${String(number).padStart(2, "0")}`;

const NOTHING: OnBoard = { numbers: new Set(), open: new Set() };

/**
 * `files` is the whole set of the plan: new files and the files of the tickets that stay. A ticket on the board
 * that is not open gets no event, because only the merge loop moves it (#st-plan-extend).
 */
export function planTickets(
  planId: string,
  files: readonly { name: string; text: string }[],
  verdict: Verdict,
  versions: Readonly<Record<string, number>> = {},
  board: OnBoard = NOTHING,
): TicketPlan {
  const failedOwn = new Set(
    verdict.failures.slice(0, verdict.ownFailures).map((f) => f.ticket),
  );
  const held = new Map<number, string[]>();
  const unplanned: string[] = [];
  for (const file of files) {
    if (failedOwn.has(file.name)) continue;
    const digits = ticketNumber(file.name);
    const number = digits === null ? 0 : Number(digits);
    if (number < 1 || number > 99) {
      unplanned.push(
        `${file.name}: a ticket file name starts with its number, from 1 to 99`,
      );
      continue;
    }
    held.set(number, [...(held.get(number) ?? []), file.name]);
  }
  for (const [number, names] of held) {
    if (names.length < 2) continue;
    held.delete(number);
    unplanned.push(
      `${names.join(", ")}: ${names.length} files hold the number ${number}`,
    );
  }
  const reasons = new Map<string, string[]>();
  for (const failure of verdict.failures.slice(verdict.ownFailures)) {
    if (failure.ticket === SET || failure.check !== "blocked_by") continue;
    reasons.set(failure.ticket, [
      ...(reasons.get(failure.ticket) ?? []),
      `${failure.check}: ${failure.message}`,
    ]);
  }
  const planned: PlannedTicket[] = [];
  for (const [number, [name]] of [...held].sort((a, b) => a[0] - b[0])) {
    const file = files.find((f) => f.name === name);
    const ticket = file && parseTicket(file.name, file.text);
    if (!ticket) continue;
    const blockers = listOf(ticket.headers.blocked_by?.value)
      .map(normalizeNumber)
      .filter((n) => held.has(Number(n)))
      .map((n) => idOf(planId, Number(n)));
    const reason = reasons.get(ticket.file)?.join("; ");
    if (board.numbers.has(number) && !board.open.has(number)) continue;
    const cited: Record<string, number> = {};
    for (const item of listOf(ticket.headers.cites?.value)) {
      const card = item.startsWith("#") ? item.slice(1) : item;
      cited[card] = versions[card] ?? 0;
    }
    planned.push({
      type: board.open.has(number) ? "ticket.replanned" : "ticket.planned",
      id: idOf(planId, number),
      title: ticket.headers.title?.value ?? "",
      blocked_by: blockers,
      cited,
      ...(reason === undefined ? {} : { reason }),
    });
  }
  return { planned, unplanned };
}
