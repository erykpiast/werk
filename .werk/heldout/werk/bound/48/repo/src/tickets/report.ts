// The output of the ticket checks: one line per failure, then a count line
// (#werk-ticket-check-verb-form, #st-ticket-checks-run).

/**
 * One failed check. `ticket` is the file that owns the failure; a set failure that no ticket owns
 * has none. `tickets` lists every ticket the failure names, the owner first (#st-ticket-partial).
 */
export type Failure = {
  ticket?: string;
  tickets?: string[];
  check: string;
  field: string;
  message: string;
};

export type Counts = {
  tickets: number;
  ownFailures: number;
  failures: number;
  cards: number;
  stories: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatFailure(failure: Failure): string {
  return `${failure.ticket ?? "ticket set"}: ${failure.check}: ${failure.field}: ${failure.message}`;
}

export function formatCounts(counts: Counts): string {
  return [
    plural(counts.tickets, "ticket", "tickets"),
    plural(counts.ownFailures, "own-check failure", "own-check failures"),
    plural(counts.failures, "failure", "failures"),
    plural(counts.cards, "decided card", "decided cards"),
    plural(counts.stories, "story", "stories"),
  ].join(", ");
}

export function formatReport(failures: Failure[], counts: Counts): string {
  return [...failures.map(formatFailure), formatCounts(counts)].map((line) => `${line}\n`).join("");
}
