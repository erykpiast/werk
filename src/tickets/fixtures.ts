/** Ticket text for the ticket-check tests. */

export type Parts = {
  title?: string;
  cites?: string;
  blockedBy?: string;
  stories?: string;
  touches?: string;
  what?: string;
  acceptance?: string;
  checks?: string;
};

/** A correct ticket, with any part replaced. A part set to null is left out. */
export function ticket(
  parts: { [K in keyof Parts]?: Parts[K] | null } = {},
): string {
  const p = {
    title: "A person can reopen a card",
    cites: "map-reopen",
    blockedBy: "",
    stories: "1",
    touches: "map view, decision log",
    what: "A person presses reopen and the card goes back to open.",
    acceptance: "- [ ] A reopened card shows as open.",
    checks: "- `make test`",
    ...parts,
  };
  const out: string[] = [];
  if (p.title !== null) out.push(`title: ${p.title}`);
  if (p.cites !== null) out.push(`cites: ${p.cites}`);
  if (p.blockedBy !== null) out.push(`blocked_by: ${p.blockedBy}`);
  if (p.stories !== null) out.push(`stories: ${p.stories}`);
  if (p.touches !== null) out.push(`touches: ${p.touches}`);
  if (p.what !== null) out.push("", "## What to build", "", p.what);
  if (p.acceptance !== null)
    out.push("", "## Acceptance criteria", "", p.acceptance);
  if (p.checks !== null) out.push("", "## Checks", "", p.checks);
  return `${out.join("\n")}\n`;
}
