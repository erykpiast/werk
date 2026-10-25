/**
 * The board as the page draws it: the fold, joined with the ticket files, the map's obligations
 * and a probe of the builder processes. Pure: the caller reads the files and supplies the probe
 * (#vi-board, #vi-board-session-file, #vi-board-read-api).
 */
import type { Obligation } from "../map/fold.ts";
import { listOf, parseTicket, sectionOf } from "../tickets/ticket-parse.ts";
import {
  type Alive,
  type Board,
  type Column,
  columnsOf,
  runningBuild,
} from "./fold.ts";

/** What a Decisions entry says of one card a build proposed (#vi-board-ticket-decisions-gone). */
export type CardState = "proposal" | "accepted" | "gone";

export type DecisionCard = { id: string; title: string; state: CardState };

/** The cards that the builds of a ticket proposed, or that they proposed none (#vi-board-ticket-decisions-2). */
export type Decisions = {
  /** Empty means "No new card". */
  cards: DecisionCard[];
  /** The cards a build recorded it followed. */
  followed: string[];
};

export type Blocker = { id: string; done: boolean };

export type TicketView = {
  id: string;
  title: string;
  column: Column;
  /** Passes that ended red. The card shows it after more than one try. */
  retries: number;
  /** Blockers that are not done. */
  openBlockers: number;
  /** True while a build session has no end and its process is alive. */
  running: boolean;
  /** The ticket file below its header lines, or "" when the file is missing. */
  text: string;
  cites: string[];
  blockers: Blocker[];
  checks: string[];
  stories: string[];
  touches: string[];
  /** Null when no build of the ticket has opened an obligation. */
  decisions: Decisions | null;
};

export type BoardView = {
  columns: Record<Column, TicketView[]>;
};

export type BoardInputs = {
  board: Board;
  isAlive: Alive;
  /** The text of a ticket file by ticket id, or undefined when there is none. */
  textOf: (id: string) => string | undefined;
  obligations: ReadonlyMap<string, Obligation>;
  /** The title and state of a card in the map, or null when the map holds none. */
  cardOf: (id: string) => { title: string; proposed: boolean } | null;
};

/** The decisions of one ticket, or null when no obligation names it. */
export function decisionsOf(
  ticket: string,
  obligations: ReadonlyMap<string, Obligation>,
  cardOf: BoardInputs["cardOf"],
): Decisions | null {
  const own = [...obligations.values()].filter((o) => o.ticket === ticket);
  if (own.length === 0) return null;
  const cards: DecisionCard[] = [];
  const followed: string[] = [];
  for (const obligation of own) {
    for (const id of obligation.proposed) {
      if (cards.some((card) => card.id === id)) continue;
      const found = cardOf(id);
      cards.push({
        id,
        title: found?.title ?? "",
        state:
          found === null ? "gone" : found.proposed ? "proposal" : "accepted",
      });
    }
    for (const id of obligation.followed ?? []) {
      if (!followed.includes(id)) followed.push(id);
    }
  }
  return { cards, followed };
}

function cleanId(id: string): string {
  return id.replace(/^#/, "");
}

/** The fields of a ticket file that the drawer shows. A missing or unparsable file has none. */
export function ticketFields(text: string | undefined): {
  text: string;
  cites: string[];
  checks: string[];
  stories: string[];
  touches: string[];
} {
  const parsed = text === undefined ? null : parseTicket("", text);
  if (parsed === null) {
    return {
      text: text ?? "",
      cites: [],
      checks: [],
      stories: [],
      touches: [],
    };
  }
  const firstHeading = parsed.sections[0]?.line ?? parsed.lines.length + 1;
  const body = parsed.lines
    .slice(firstHeading - 1)
    .join("\n")
    .trim();
  const checks = (sectionOf(parsed, "Checks")?.body ?? [])
    .map((line) => /^[-*]\s+(?:\[.\]\s+)?(.*)$/.exec(line.text.trim())?.[1])
    .filter((item): item is string => item !== undefined && item !== "")
    .map((item) => item.replace(/^`(.*)`$/, "$1"));
  return {
    text: body,
    cites: listOf(parsed.headers.cites?.value).map(cleanId),
    checks,
    stories: listOf(parsed.headers.stories?.value),
    touches: listOf(parsed.headers.touches?.value),
  };
}

/** The board in its five columns, each ticket with what the card and the drawer show. */
export function boardView(inputs: BoardInputs): BoardView {
  const { board, isAlive } = inputs;
  const ids = columnsOf(board);
  const view = (id: string): TicketView => {
    const ticket = board.tickets.get(id);
    if (ticket === undefined) throw new Error(`no ticket ${id}`);
    const blockers = ticket.blockedBy.map((other) => ({
      id: other,
      done: board.tickets.get(other)?.column === "done",
    }));
    return {
      id,
      title: ticket.title,
      column: ticket.column,
      retries: ticket.retries,
      openBlockers: blockers.filter((b) => !b.done).length,
      running:
        ticket.column === "building" &&
        runningBuild(ticket, isAlive) !== undefined,
      ...ticketFields(inputs.textOf(id)),
      blockers,
      decisions: decisionsOf(id, inputs.obligations, inputs.cardOf),
    };
  };
  const columns = {} as Record<Column, TicketView[]>;
  for (const column of Object.keys(ids) as Column[]) {
    columns[column] = ids[column].map(view);
  }
  return { columns };
}
