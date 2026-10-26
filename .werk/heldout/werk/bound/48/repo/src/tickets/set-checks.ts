// The three checks on the whole ticket set: cards cited, stories delivered, blocked_by
// (#st-ticket-set-checks). They read only the tickets that passed their own checks.
import type { TicketFields } from "./own-checks.ts";
import type { Failure } from "./report.ts";

export type SetTicket = TicketFields & { file: string };

/** A ticket's number is the number its file name starts with, as `02` in `02-reopen.md`. */
export function ticketNumber(file: string): number | undefined {
  const digits = /^(\d+)/.exec(file.split(/[/\\]/).at(-1) ?? "");
  return digits === null ? undefined : Number(digits[1]);
}

function cardsCited(tickets: SetTicket[], cards: string[]): Failure[] {
  const cited = new Set(tickets.flatMap((ticket) => ticket.cites));
  const uncited = cards.filter((card) => !cited.has(card));
  if (uncited.length === 0) return [];
  const list = uncited.map((card) => `#${card}`).join(", ");
  return [{ check: "cards-cited", field: "cites", message: `no ticket cites ${list}` }];
}

function storiesDelivered(tickets: SetTicket[], stories: number[]): Failure[] {
  const delivered = new Set(tickets.flatMap((ticket) => ticket.stories));
  const known = new Set(stories);
  const missing = stories.filter((story) => !delivered.has(story));
  const unknown = [...delivered].filter((story) => !known.has(story)).sort((a, b) => a - b);
  const failures: Failure[] = [];
  if (missing.length > 0)
    failures.push({ check: "stories", field: "stories", message: `no ticket delivers story ${missing.join(", ")}` });
  if (unknown.length > 0)
    failures.push({
      check: "stories",
      field: "stories",
      message: `a ticket names story ${unknown.join(", ")}, which the spec does not have`,
    });
  return failures;
}

/** The strongly connected parts of the blocked_by graph that hold a cycle, each in file order. */
function cycles(tickets: SetTicket[], byNumber: Map<number, SetTicket[]>): SetTicket[][] {
  const next = (ticket: SetTicket) => ticket.blockedBy.flatMap((n) => byNumber.get(n) ?? []);
  const index = new Map<SetTicket, number>();
  const low = new Map<SetTicket, number>();
  const stack: SetTicket[] = [];
  const found: SetTicket[][] = [];
  const visit = (ticket: SetTicket): void => {
    index.set(ticket, index.size);
    low.set(ticket, index.get(ticket) as number);
    stack.push(ticket);
    for (const blocker of next(ticket)) {
      if (!index.has(blocker)) {
        visit(blocker);
        low.set(ticket, Math.min(low.get(ticket) as number, low.get(blocker) as number));
      } else if (stack.includes(blocker)) {
        low.set(ticket, Math.min(low.get(ticket) as number, index.get(blocker) as number));
      }
    }
    if (low.get(ticket) !== index.get(ticket)) return;
    const part: SetTicket[] = [];
    for (let top = stack.pop(); top !== undefined; top = top === ticket ? undefined : stack.pop()) part.push(top);
    if (part.length > 1 || next(ticket).includes(ticket)) found.push(part.sort((a, b) => a.file.localeCompare(b.file)));
  };
  for (const ticket of tickets) if (!index.has(ticket)) visit(ticket);
  return found.sort((a, b) => (a[0] as SetTicket).file.localeCompare((b[0] as SetTicket).file));
}

function blockedBy(tickets: SetTicket[]): Failure[] {
  const byNumber = new Map<number, SetTicket[]>();
  for (const ticket of tickets) {
    const n = ticketNumber(ticket.file);
    if (n !== undefined) byNumber.set(n, [...(byNumber.get(n) ?? []), ticket]);
  }
  const failures: Failure[] = [];
  for (const ticket of tickets) {
    for (const n of ticket.blockedBy) {
      if (!byNumber.has(n))
        failures.push({
          ticket: ticket.file,
          tickets: [ticket.file],
          check: "blocked_by",
          field: "blocked_by",
          message: `ticket ${n} is not in the set`,
        });
    }
  }
  for (const cycle of cycles(tickets, byNumber)) {
    const files = cycle.map((ticket) => ticket.file);
    failures.push({
      ticket: files[0] as string,
      tickets: files,
      check: "blocked_by",
      field: "blocked_by",
      message: `a blocked_by cycle: ${files.join(", ")}`,
    });
  }
  return failures;
}

/** Runs the three set checks over the tickets that passed their own checks. */
export function setChecks(tickets: SetTicket[], cards: string[], stories: number[]): Failure[] {
  return [...cardsCited(tickets, cards), ...storiesDelivered(tickets, stories), ...blockedBy(tickets)];
}
