// One run of every ticket check on a set of ticket files: the own checks on each file, then the
// set checks on the files that passed them (#st-ticket-checks-run).
import { ownChecks } from "./own-checks.ts";
import type { Counts, Failure } from "./report.ts";
import { type SetTicket, setChecks } from "./set-checks.ts";

export type TicketFile = { file: string; text: string };

export type CheckResult = { failures: Failure[]; counts: Counts };

export function checkTickets(files: TicketFile[], cards: string[], stories: number[]): CheckResult {
  const own: Failure[] = [];
  const passed: SetTicket[] = [];
  for (const { file, text } of files) {
    const result = ownChecks(file, text);
    own.push(...result.failures);
    if (result.failures.length === 0) passed.push({ file, ...result.fields });
  }
  const failures = [...own, ...setChecks(passed, cards, stories)];
  return {
    failures,
    counts: {
      tickets: files.length,
      ownFailures: own.length,
      failures: failures.length,
      cards: cards.length,
      stories: stories.length,
    },
  };
}
