// A write checks all of its events against the folded map, in order, and appends all of them or
// none (#pr-log-refuse). It also runs the contract check on each card the write decides or
// changes (#werk-contract), which the fold does not: a card decided before a fact became required
// still folds (#werk-contract-amend-scope). This is the check; the store does the append.
import { contractRefusal } from "./contract.ts";
import { copyMap, step } from "./fold.ts";
import type { Draft, Event, FoldedMap } from "./types.ts";

export type Prepared = { ok: true; events: Event[] } | { ok: false; rule: string };

/** Stamps each draft with the next `seq` and the time `at`, and checks it on a copy of `map`. */
export function prepare(map: FoldedMap, drafts: Draft[], at: string): Prepared {
  const trial = copyMap(map);
  const events: Event[] = [];
  for (const draft of drafts) {
    const event = { seq: trial.lastSeq + 1, at, actor: draft.actor, type: draft.type, payload: draft.payload } as Event;
    const broken = step(trial, event);
    if (broken !== undefined) return { ok: false, rule: broken };
    events.push(event);
  }
  const refusal = contractRefusal(map, trial, events);
  if (refusal !== undefined) return { ok: false, rule: refusal };
  return { ok: true, events };
}

/** The log lines of the events: one JSON object per line, each line ended. */
export function toLines(events: Event[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}
