/** Turns the number a person types into a ticket id on the board. */
import type { Board } from "./fold.ts";

export type Resolved = { ok: true; id: string } | { ok: false; error: string };

/**
 * A full id (<plan run>/<NN>) names its ticket. A bare number names the one ticket
 * that ends in it; a number on two plans is refused, and so is one on no plan.
 */
export function resolveTicket(board: Board, arg: string): Resolved {
  if (arg.includes("/")) {
    return board.tickets.has(arg)
      ? { ok: true, id: arg }
      : { ok: false, error: `no ticket ${arg} on the board` };
  }
  const number = /^\d$/.test(arg) ? `0${arg}` : arg;
  const matches = [...board.tickets.values()].filter(
    (t) => t.number === number,
  );
  const [only] = matches;
  if (only === undefined || matches.length > 1)
    return {
      ok: false,
      error:
        matches.length > 1
          ? `number ${arg} is on ${matches.length} plans; give <plan run>/${number}`
          : `no ticket number ${arg} on the board`,
    };
  return { ok: true, id: only.id };
}
