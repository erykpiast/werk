/**
 * Writing a follow-up ticket: a new ticket file in the run's folder, and its planned event on
 * the board. A red check at the merge files one (#ms-merge-red-follow-up), a held-out step that fails files one (#lp-heldout-feedback), so does a ticket
 * that merged with small grader gaps (#st-grade-defer), and so does a
 * decision a merged ticket was built on that changed or went (#st-build-missing-decision).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import type { Ticket } from './board.ts'
import { decisionFollowUpText } from './decision-pass.ts'
import { decisionStepText } from './heldout-text.ts'
import type { Step } from './heldout-text.ts'
import { parseTicket, ticketChecks, type ParsedTicket } from './ticket.ts'

/** Write the ticket file of the run under the first free number from 01 to 99, counted over the
 *  folder and, when `boardPath` is given, the board (#st-grade-defer-follow-up-file). Returns its
 *  id and its path from `cwd`. */
export function writeTicketFile(cwd: string, run: string, text: string, boardPath?: string): { id: string; file: string } {
  const dir = join(cwd, '.werk', 'tickets', run)
  mkdirSync(dir, { recursive: true })
  const taken = new Set(
    readdirSync(dir)
      .map((f) => Number(f.match(/^\d+/)?.[0] ?? NaN))
      .filter(Number.isFinite),
  )
  if (boardPath) {
    for (const t of foldBoard(readBoard(boardPath)).tickets.values()) if (t.run === run) taken.add(Number(t.id.slice(run.length + 1)))
  }
  let n = 1
  while (taken.has(n) && n <= 99) n++
  if (n > 99) throw new Error(`no free ticket number from 01 to 99 in ${run}`)
  const num = String(n).padStart(2, '0')
  const file = join('.werk', 'tickets', run, `${num}.md`)
  writeFileSync(join(cwd, file), text)
  return { id: `${run}/${num}`, file }
}

/** #st-grade-defer: file the small gaps a ticket merged with on its last pass, as a ticket that
 *  waits for it. It cites the cards of the gaps. Returns its id. */
export function fileGapFollowUp(cwd: string, o: { of: string; run: string; gaps: Array<{ card: string; gap: string }>; ticket: ParsedTicket; boardPath: string }): string {
  const text = `title: Close the gaps the grader found in ${o.of}
cites: ${[...new Set(o.gaps.map((g) => g.card))].join(', ')}
blocked_by:
stories:
touches: ${(o.ticket.touches ?? []).join(', ')}

## What to build

${o.of} merged with a small gap in each card below. The grader of its last pass found them. Close each gap, word for word as the grader wrote it.

${o.gaps.map((g) => `- #${g.card}: ${g.gap}`).join('\n')}

## Acceptance criteria

${o.gaps.map((g) => `- [ ] The gap in #${g.card} is closed`).join('\n')}

## Checks

${ticketChecks(o.ticket).map((c) => `- \`${c}\``).join('\n')}
`
  const { id, file } = writeTicketFile(cwd, o.run, text, o.boardPath)
  appendBoard('ticket.planned', { id, run: o.run, file, title: `Close the gaps the grader found in ${o.of}`, blockedBy: [o.of], followUpOf: o.of }, { path: o.boardPath })
  return id
}

/** #ms-merge-red-follow-up: file the red checks a ticket merged with, as a ticket that waits for
 *  nothing, because the ticket is merged. It quotes each check's output and has the checks as its
 *  own. Returns its id. */
export function fileRedCheckFollowUp(cwd: string, o: { of: string; run: string; failed: Array<{ cmd: string; tail: string }>; ticket: ParsedTicket; boardPath: string }): string {
  const title = `Fix the red checks of ${o.of}`
  const text = `title: ${title}
cites: ${(o.ticket.cites ?? []).join(', ')}
blocked_by:
stories:
touches: ${(o.ticket.touches ?? []).join(', ')}

## What to build

${o.of} merged with a red check on the main line's tree. Find out whether the check or the code is wrong, and fix it, so that each check below is green and stays green. A check that is flaky gets steady, with no rerun.

${o.failed.map((c) => `- \`${c.cmd}\`:\n\n\`\`\`\n${c.tail}\n\`\`\``).join('\n\n')}

## Acceptance criteria

${o.failed.map((c) => `- [ ] \`${c.cmd}\` is green on the main line's tree`).join('\n')}

## Checks

${o.failed.map((c) => `- \`${c.cmd}\``).join('\n')}
`
  const { id, file } = writeTicketFile(cwd, o.run, text, o.boardPath)
  appendBoard('ticket.planned', { id, run: o.run, file, title, blockedBy: [], followUpOf: o.of }, { path: o.boardPath })
  return id
}

/** File the rework of a merged ticket whose proposals changed, in ready. Returns its id. It
 *  cites what the merged ticket cited, minus every card that is gone. `open` is the rework of
 *  the same ticket that has not started to build: it takes the changes in place, and no second
 *  ticket is filed (#st-followup-one-open). */
export function fileDecisionFollowUp(cwd: string, o: { of: Ticket; changes: string[]; live: (id: string) => boolean; boardPath: string; open?: Ticket }): string {
  const path = join(cwd, o.of.file)
  const parsed = existsSync(path) ? parseTicket(o.of.file.split('/').pop()!, readFileSync(path, 'utf8')) : undefined
  const cites = [...(parsed?.cites ?? []), ...Object.keys(o.of.proposals ?? {})].filter(o.live)
  const text = decisionFollowUpText({ of: o.of.id, changes: o.changes, cites: [...new Set(cites)], checks: parsed ? ticketChecks(parsed) : [], touches: parsed?.touches })
  const title = `Rework ${o.of.id}: a decision it was built on changed`
  if (o.open) {
    writeFileSync(join(cwd, o.open.file), text)
    appendBoard('ticket.revised', { id: o.open.id, title, blockedBy: o.open.blockedBy }, { path: o.boardPath })
    return o.open.id
  }
  const { id, file } = writeTicketFile(cwd, o.of.run, text, o.boardPath)
  appendBoard('ticket.planned', { id, run: o.of.run, file, title, blockedBy: [], followUpOf: o.of.id, rework: true }, { path: o.boardPath })
  return id
}

/** #st-heldout-step-contradiction: file the ticket that judges held-out steps against the decided
 *  cards they contradict, for the ticket whose steps they are. It carries no steps of its own, so
 *  the steps count as held back, not as covered. Returns its id. */
export function fileStepDecision(cwd: string, o: { run: string; of: Ticket; found: Array<{ step: Step; card: string; why: string }>; cites: string[]; checks: string[]; touches?: string[]; boardPath: string }): string {
  const { id, file } = writeTicketFile(cwd, o.run, decisionStepText({ of: o.of.id, steps: o.found, cites: o.cites, checks: o.checks, touches: o.touches }), o.boardPath)
  appendBoard('ticket.planned', { id, run: o.run, file, title: `Judge held-out steps of ${o.of.id} against a card: ${o.found.map((f) => f.step.id).join(', ')}`, blockedBy: [], followUpOf: o.of.id }, { path: o.boardPath })
  return id
}
