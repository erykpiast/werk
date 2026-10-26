/**
 * A ticket's text, parsed from its file in .werk/tickets/<run>/<NN>.md (#st-ticket). The board
 * (board.ts) knows where a ticket is; this module knows what it says. Pure: board-files.ts
 * reads the files and hands their text here.
 *
 * The file shape is ticket.ts's: header lines `title:`, `cites:`, `blocked_by:`, `stories:`,
 * then the slice in markdown, then `## Checks` with one command per bullet.
 */
import { checkTicketFile, parseTicket, ticketChecks } from './ticket.ts'
import type { BoardEvent, BoardEventMap } from './board.ts'

const HEADER = /^(title|cites|blocked_by|stories|touches|files):/

export type TicketText = {
  title: string
  cites: string[]
  /** Ticket numbers, as written. */
  blockedBy: string[]
  stories: string[]
  /** The module names the scheduler compares (#st-build-parallel). */
  touches: string[]
  /** The slice: the markdown between the header and `## Checks`. */
  body: string
  /** The commands that decide the ticket: its own, or the rubric's default set. */
  checks: string[]
}

/**
 * The fields through ticket.ts's parser, the one `werk plan` and `werk build` use, plus the
 * slice as markdown for the drawer: everything after the header lines, up to `## Checks`.
 */
export function parseTicketText(text: string): TicketText | undefined {
  const t = parseTicket('00.md', text)
  if (!t) return undefined
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && (lines[i].trim() === '' || HEADER.test(lines[i]))) i++
  const rest = lines.slice(i).join('\n')
  const at = rest.search(/^##\s+Checks\s*$/im)
  return {
    title: t.title,
    cites: t.cites,
    blockedBy: t.blockedBy.map(String),
    stories: t.stories.map(String),
    touches: t.touches,
    body: (at < 0 ? rest : rest.slice(0, at)).trim(),
    checks: ticketChecks(t),
  }
}

/**
 * A plan run id is one path segment under .werk/tickets/: a plain name, no slash, no leading
 * dot, so `..` or `a/../../x` never reads outside the tickets folder. Same idea as
 * convo-names.ts's CARD_ID.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
export const isRunId = (run: string): boolean => RUN_ID.test(run)

/** A ticket id is "<run id>/<number>", the only shape `werk plan` and the held-out author write. */
export function isTicketId(id: string): boolean {
  const m = /^([^/]+)\/(\d+)$/.exec(id)
  return !!m && isRunId(m[1])
}

/** A ticket's board id, the way `werk plan` makes it: "<run>/<NN>", two digits at least. */
export const ticketId = (run: string, num: number | string) => `${run}/${String(Number(num)).padStart(2, '0')}`

/**
 * The ticket.planned payloads for one run's files that the board does not hold yet, and the
 * files kept off it because they fail their own checks (#st-ticket-own-checks,
 * #st-ticket-partial), each with the failed details. Pure: the caller reads the files.
 * Running it twice over the same files plans nothing the second time, which is what makes
 * `werk ticket import` idempotent.
 */
export function plannedFromRun(
  run: string,
  files: Array<{ name: string; path: string; text: string }>,
  known: Set<string>,
): { planned: Array<BoardEventMap['ticket.planned']>; failed: Array<{ name: string; failures: string[] }> } {
  const planned: Array<BoardEventMap['ticket.planned']> = []
  const failed: Array<{ name: string; failures: string[] }> = []
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const id = ticketId(run, f.name.replace(/\.md$/, ''))
    if (known.has(id)) continue
    const { ticket, checks } = checkTicketFile(f.name, f.text)
    const failures = checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`)
    if (!ticket || failures.length) {
      failed.push({ name: f.name, failures })
      continue
    }
    planned.push({ id, run, file: f.path, title: ticket.title, blockedBy: ticket.blockedBy.map((n) => ticketId(run, n)) })
  }
  return { planned, failed }
}

/** Every ticket id the board has ever planned, archived ones included. */
export function plannedIds(events: BoardEvent[]): Set<string> {
  return new Set(events.filter((e) => e.type === 'ticket.planned').map((e) => (e.payload as { id: string }).id))
}

const clip = (s: string, n = 240) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/**
 * One line of the builder's stream-json log, as a line a person reads in the live preview.
 * Undefined for an event that says nothing (a bare system ping). An unknown shape is shown
 * clipped rather than dropped, so a log the builder writes in its own format still shows.
 */
/** When a session log line was written, if it says: an agent message's `timestamp`, an
 *  overseer act's `at`. Session events and results carry no time. */
export function logLineTime(raw: string): string | undefined {
  try {
    const e = JSON.parse(raw)
    const at = e?.timestamp ?? e?.at
    return typeof at === 'string' ? at : undefined
  } catch {
    return undefined
  }
}

export function summarizeLogLine(raw: string): string | undefined {
  const line = raw.trim()
  if (!line) return undefined
  let e: any
  try {
    e = JSON.parse(line)
  } catch {
    return clip(line)
  }
  if (typeof e !== 'object' || e === null) return clip(String(e))
  if (e.type === 'assistant' || e.type === 'user') {
    const content = e.message?.content
    if (typeof content === 'string') return clip(`${e.type === 'user' ? '← ' : ''}${content}`)
    const parts: string[] = []
    for (const c of Array.isArray(content) ? content : []) {
      if (c.type === 'text' && c.text?.trim()) parts.push(clip(c.text))
      else if (c.type === 'tool_use') {
        const input = c.input ?? {}
        const arg = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? ''
        parts.push(clip(`▸ ${c.name}${arg ? ` ${arg}` : ''}`))
      } else if (c.type === 'tool_result') {
        const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join(' ')
        parts.push(clip(`${c.is_error ? '✗ ' : '← '}${text}`, 160))
      }
    }
    return parts.length ? parts.join('\n') : undefined
  }
  // The overseer's acts share the stream (#lp-overseer): a progress check, a frozen call it
  // cancelled or killed, a permission ask it answered.
  if (e.type === 'werk_overseer') {
    const what =
      e.kind === 'progress'
        ? e.looping ? `looping — ${e.reason ?? ''}` : 'progress ok'
        : e.kind === 'frozen'
          ? `${e.act ?? 'stopped'}: ${e.tool ?? ''} used no CPU`
          : e.kind === 'ask'
            ? `${e.allow ? 'allowed' : 'denied'} ${e.tool ?? ''}${e.comment ? ` — ${e.comment}` : ''}`
            : e.kind === 'probe-failed'
              ? `process probe failed during ${e.tool ?? 'a call'} — ${e.error ?? ''}`
              : e.kind === 'probes'
                ? `${e.failed ?? 0} of ${e.samples ?? 0} process probes failed`
                : `${e.kind ?? ''}${e.reason ? ` — ${e.reason}` : ''}`
    return clip(`overseer: ${what}`)
  }
  if (e.type === 'result') return clip(`result: ${e.subtype ?? ''}${e.result ? ` — ${e.result}` : ''}`)
  if (e.type === 'system') return e.subtype === 'init' ? `session ${e.session_id ?? ''} started`.trim() : undefined
  if (typeof e.text === 'string') return clip(e.text)
  return clip(line)
}
