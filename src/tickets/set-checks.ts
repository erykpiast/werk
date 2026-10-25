/** The three checks on the whole ticket set (#st-ticket-set-checks). Pure. */
import type { Failure } from "./own-checks.ts";
import {
  listOf,
  normalizeNumber,
  type Ticket,
  ticketNumber,
} from "./ticket-parse.ts";

export const SET = "ticket set";

const field = (ticket: Ticket, name: "cites" | "blocked_by" | "stories") =>
  listOf(ticket.headers[name]?.value);

const cardOf = (item: string) => (item.startsWith("#") ? item.slice(1) : item);

/** The tickets on a cycle: those in a strongly connected group of two or more, or with a self-loop. */
function onCycles(edges: Map<string, string[]>): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const open = new Set<string>();
  const cyclic = new Set<string>();
  let counter = 0;
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    open.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(
          node,
          Math.min(low.get(node) as number, low.get(next) as number),
        );
      } else if (open.has(next)) {
        low.set(
          node,
          Math.min(low.get(node) as number, index.get(next) as number),
        );
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const group: string[] = [];
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      open.delete(top);
      group.push(top);
      if (top === node) break;
    }
    if (group.length > 1 || (edges.get(node) ?? []).includes(node)) {
      for (const member of group) cyclic.add(member);
    }
  };
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  return cyclic;
}

/** The decided cards that no ticket cites (#st-ticket-set-checks). */
export function uncitedCards(
  tickets: readonly Ticket[],
  decided: readonly string[],
): string[] {
  const cited = new Set(tickets.flatMap((t) => field(t, "cites").map(cardOf)));
  return decided.filter((id) => !cited.has(id));
}

/** Runs the set checks on the tickets that passed their own checks. */
export function setChecks(
  tickets: readonly Ticket[],
  decided: readonly string[],
  stories: readonly string[],
): Failure[] {
  const failures: Failure[] = [];

  const uncited = uncitedCards(tickets, decided);
  if (uncited.length > 0) {
    failures.push({
      ticket: SET,
      check: "cards-cited",
      field: "cites",
      message: `no ticket cites: ${uncited.join(", ")}`,
    });
  }

  const delivered = new Set(
    tickets.flatMap((t) => field(t, "stories").map(normalizeNumber)),
  );
  const missing = stories.filter((story) => !delivered.has(story));
  const known = new Set(stories);
  const unknown = [...delivered].filter((story) => !known.has(story));
  if (missing.length > 0) {
    failures.push({
      ticket: SET,
      check: "stories",
      field: "stories",
      message: `no ticket delivers: ${missing.join(", ")}`,
    });
  }
  if (unknown.length > 0) {
    failures.push({
      ticket: SET,
      check: "stories",
      field: "stories",
      message: `not in the spec: ${unknown.join(", ")}`,
    });
  }

  // blocked_by. A number held by two files names no ticket (#st-ticket-shape-number-from-file-name).
  const holders = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    const number = ticketNumber(ticket.file);
    if (number !== null)
      holders.set(number, [...(holders.get(number) ?? []), ticket]);
  }
  for (const group of holders.values()) {
    if (group.length < 2) continue;
    for (const ticket of group) {
      failures.push({
        ticket: ticket.file,
        check: "blocked_by",
        field: "file name",
        message: `its number is also the number of ${group
          .filter((t) => t !== ticket)
          .map((t) => t.file)
          .join(", ")}`,
      });
    }
  }
  const blockers = new Map<string, string>();
  for (const [number, group] of holders) {
    if (group.length === 1) blockers.set(number, (group[0] as Ticket).file);
  }
  const edges = new Map<string, string[]>();
  for (const ticket of tickets) {
    const targets: string[] = [];
    for (const item of field(ticket, "blocked_by").map(normalizeNumber)) {
      const file = blockers.get(item);
      if (file === undefined) {
        failures.push({
          ticket: ticket.file,
          check: "blocked_by",
          field: "blocked_by",
          message: `blocker ${item} is not in the set`,
        });
      } else targets.push(file);
    }
    edges.set(ticket.file, targets);
  }
  const cyclic = onCycles(edges);
  for (const ticket of tickets) {
    if (!cyclic.has(ticket.file)) continue;
    failures.push({
      ticket: ticket.file,
      check: "blocked_by",
      field: "blocked_by",
      message: "the ticket is on a blocked_by cycle",
    });
  }
  return failures;
}
