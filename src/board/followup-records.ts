/**
 * Follow-up records of a finished ticket: the request, its class, and the corrections
 * that replace it. See #werk-cli-followup, #ms-outcome-followup, #werk-cli-followup-event
 * and #werk-cli-followup-correction.
 */

export const FOLLOWUP_CLASSES = ["plan", "build"] as const;
export const FOLLOWUP_FOUND = ["review", "after-merge"] as const;
export type FollowupClass = (typeof FOLLOWUP_CLASSES)[number];
export type FollowupFound = (typeof FOLLOWUP_FOUND)[number];

export type FollowupRecord = {
  /** Originals and corrections share one sequence per ticket, from 1. */
  n: number;
  class: FollowupClass;
  found: FollowupFound;
  why: string;
  /** Whether a check could have caught the defect. Only a build miss has it. */
  catchable?: boolean;
  /** The number of the original record that this record corrects. */
  of?: number;
};

export type FollowupRefusal = {
  rule: "bad-event" | "bad-move";
  detail: string;
};

type Rec = Record<string, unknown>;

const refuse = (
  rule: FollowupRefusal["rule"],
  detail: string,
): FollowupRefusal => ({ rule, detail });

/** The record an event describes, or the reason it is refused. `records` are those already on the ticket. */
export function buildFollowupRecord(
  records: readonly FollowupRecord[],
  rec: Rec,
): FollowupRecord | FollowupRefusal {
  const cls = rec.class;
  if (!FOLLOWUP_CLASSES.includes(cls as FollowupClass))
    return refuse("bad-event", `class is ${FOLLOWUP_CLASSES.join(" or ")}`);
  const found = rec.found;
  if (!FOLLOWUP_FOUND.includes(found as FollowupFound))
    return refuse("bad-event", `found is ${FOLLOWUP_FOUND.join(" or ")}`);
  const why = rec.why;
  if (typeof why !== "string" || why.trim() === "")
    return refuse("bad-event", "a follow-up record needs a reason");
  const record: FollowupRecord = {
    n: records.length + 1,
    class: cls as FollowupClass,
    found: found as FollowupFound,
    why,
  };
  if (cls === "build") {
    if (typeof rec.catchable !== "boolean")
      return refuse(
        "bad-event",
        "a build miss needs the catchable answer, yes or no",
      );
    record.catchable = rec.catchable;
  } else if (rec.catchable !== undefined)
    return refuse("bad-event", "a plan miss has no catchable answer");
  if (rec.of !== undefined) {
    const of = rec.of;
    const original = records.find((r) => r.n === of);
    if (typeof of !== "number" || original === undefined)
      return refuse("bad-event", `there is no record ${String(of)} to correct`);
    if (original.of !== undefined)
      return refuse(
        "bad-event",
        `record ${of} is itself a correction; correct the original record ${original.of}`,
      );
    record.of = of;
  }
  return record;
}

/** The record in force for an original: its last correction, or itself. */
export function inForce(
  records: readonly FollowupRecord[],
  original: FollowupRecord,
): FollowupRecord {
  let latest = original;
  for (const r of records) if (r.of === original.n) latest = r;
  return latest;
}

const recordText = (r: FollowupRecord): string =>
  `${r.class} miss, found ${r.found}${
    r.catchable === undefined
      ? ""
      : `, check could catch: ${r.catchable ? "yes" : "no"}`
  } - ${r.why}`;

/** One line per record, numbered. An original shows the correction in force; a corrected one says by which record. */
export function followupLines(records: readonly FollowupRecord[]): string[] {
  return records.map((r) => {
    if (r.of !== undefined)
      return `${r.n}. correction of ${r.of}: ${recordText(r)}`;
    const force = inForce(records, r);
    if (force === r) return `${r.n}. ${recordText(r)}`;
    return `${r.n}. corrected by ${force.n}, in force: ${recordText(force)}`;
  });
}
