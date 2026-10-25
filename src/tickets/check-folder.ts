/** One verdict for a folder of tickets: the own checks, then the set checks (#st-ticket-checks-run). Pure. */
import { type Failure, ownChecks } from "./own-checks.ts";
import { setChecks } from "./set-checks.ts";
import { parseTicket, type Ticket } from "./ticket-parse.ts";

export type TicketFile = { name: string; text: string };

export type Verdict = {
  failures: Failure[];
  tickets: number;
  ownFailures: number;
  decided: number;
  stories: number;
};

export function checkTickets(
  files: readonly TicketFile[],
  decided: readonly string[],
  stories: readonly string[],
): Verdict {
  const failures: Failure[] = [];
  const passed: Ticket[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const ticket = parseTicket(file.name, file.text);
    if (!ticket) {
      failures.push({
        ticket: file.name,
        check: "title",
        field: "title",
        message: 'the file has no "title:" line, so no other check ran',
      });
      continue;
    }
    const own = ownChecks(ticket);
    failures.push(...own);
    if (own.length === 0) passed.push(ticket);
  }
  const ownFailures = failures.length;
  failures.push(...setChecks(passed, decided, stories));
  return {
    failures,
    tickets: files.length,
    ownFailures,
    decided: decided.length,
    stories: stories.length,
  };
}

export function formatVerdict(verdict: Verdict): string[] {
  const lines = verdict.failures.map(
    (f) => `${f.ticket}: ${f.check}: ${f.field}: ${f.message}`,
  );
  lines.push(
    `${verdict.tickets} tickets, ${verdict.ownFailures} own-check failures, ${verdict.failures.length} failures, ${verdict.decided} decided cards, ${verdict.stories} stories`,
  );
  return lines;
}
