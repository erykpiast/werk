/**
 * The ticket format and the checks on a ticket set. See #st-ticket, #st-ticket-stories.
 *
 * A ticket is a markdown file. Five header lines, then three sections:
 *
 *   title: ...
 *   cites: card ids
 *   blocked_by: ticket numbers
 *   stories: spec story numbers (empty for a prefactor, a refactor, an internal fix)
 *   touches: the names of the modules it changes, concept names and not paths
 *            (#st-build-parallel: the scheduler compares them)
 *
 *   ## What to build
 *   ## Acceptance criteria
 *   ## Checks
 *
 * A ticket names no file paths: they go out of date before the build reaches the ticket.
 * Everything here is pure, so `werk plan` and `werk build` read a ticket the same way.
 */
import { DEFAULT_CHECKS, isMakeCheck } from './rubric.ts'

export type ParsedTicket = {
  file: string
  num: number
  title: string
  cites: string[]
  blockedBy: number[]
  stories: number[]
  /** The modules the ticket changes, by name (#st-build-parallel). */
  touches: string[]
  whatToBuild: string
  acceptance: string[]
  /** As written. Empty when the ticket names none; see `ticketChecks`. */
  checks: string[]
  /** The file still has a `files:` header, which #st-ticket removed. */
  namesFiles: boolean
}

/** #st-ticket-own-checks: the checks on one ticket file, each read from the file alone.
 *  `touches` exists because the scheduler reads the module names (#st-build-parallel). */
export const OWN_CHECKS = ['title', 'shape', 'size','what-to-build', 'acceptance', 'no-file-paths', 'make-targets', 'touches'] as const
/** #st-ticket-set-checks: the three checks on the whole set. */
export const SET_CHECKS = ['cards-cited', 'stories', 'blocked_by'] as const
export type CheckName = (typeof OWN_CHECKS)[number] | (typeof SET_CHECKS)[number]

export type TicketCheck = {
  file: string
  check: CheckName
  ok: boolean
  detail: string
  /** The ticket numbers a failed set check names. Only blocked_by names any (#st-ticket-partial). */
  tickets?: number[]
}

/** One ticket file's entry in .werk/tickets/<run>/checks.json (#st-ticket-own-checks). */
export type TicketFileChecks = { file: string; chars: number; checks: Array<{ check: CheckName; ok: boolean; detail: string }> }

export const MAX_TICKET_CHARS = 4000

/** The shape the planner is told to write. Kept beside the parser that reads it. */
export const TICKET_FORMAT = `title: <one line>
cites: <comma-separated card ids that this ticket builds>
blocked_by: <comma-separated numbers of other tickets this one needs first, or empty>
stories: <comma-separated numbers of the spec's user stories this ticket delivers, or empty>
touches: <comma-separated names of the modules this ticket changes — concept names such as "merge queue", never file paths>

## What to build

<the end-to-end behaviour this ticket makes work, from the user's side — not a list of layers>

## Acceptance criteria

- [ ] <one criterion a person can verify>
- [ ] <...>

## Checks

- \`make test\`
- \`make typecheck\`
- \`make lint\``

const csv = (s: string | undefined) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [])

/** The text under `## <heading>`, up to the next `## ` heading. */
export function section(text: string, heading: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`)
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

const bullets = (text: string) =>
  text
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/)?.[1]?.trim())
    .filter((x): x is string => !!x)

export function parseTicket(file: string, text: string): ParsedTicket | undefined {
  const get = (key: string) => text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim()
  const title = get('title')
  if (!title) return undefined
  const num = (s: string) => Number(s.replace(/^#/, ''))
  return {
    file,
    num: Number(file.replace(/\.md$/, '')),
    title,
    cites: csv(get('cites')).map((id) => id.replace(/^#/, '')),
    blockedBy: csv(get('blocked_by')).map(num).filter(Number.isFinite),
    stories: csv(get('stories')).map(num).filter(Number.isFinite),
    touches: csv(get('touches')),
    whatToBuild: section(text, 'What to build'),
    acceptance: bullets(section(text, 'Acceptance criteria')),
    checks: bullets(section(text, 'Checks')).map((c) => c.replace(/^`(.*)`$/, '$1')),
    namesFiles: /^files:/m.test(text),
  }
}

/** The checks that decide the ticket: its own, or the rubric's default set. */
export function ticketChecks(t: ParsedTicket): string[] {
  return t.checks.length > 0 ? t.checks : [...DEFAULT_CHECKS]
}

/** #st-ticket-shape: the header lines and the section headings every ticket holds, in order.
 *  A header line may be empty; it must be there. */
export const HEADER_LINES = ['title', 'cites', 'blocked_by', 'stories', 'touches'] as const
export const SECTIONS = ['What to build', 'Acceptance criteria', 'Checks'] as const

/** Each header line and section heading the text does not hold, as written in the format. */
export function missingShape(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim())
  return [
    ...HEADER_LINES.filter((key) => !lines.some((l) => l.startsWith(`${key}:`))).map((key) => `${key}:`),
    ...SECTIONS.filter((h) => !lines.some((l) => l.toLowerCase() === `## ${h.toLowerCase()}`)).map((h) => `## ${h}`),
  ]
}

/** A URL is not a path, so a token with a scheme or a leading www. is skipped. */
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i
/** #st-ticket-own-checks: a `/` between two name characters, ending in a dot and 1 to 5
 *  letters or digits. `*` is a name character, so `src/*.ts` counts. */
const PATH_LIKE = /[\w*.-]\/[\w*.-]/
const PATH_END = /\.[A-Za-z0-9]{1,5}$/

/** Every file path the text names, with its 1-based line number. A pattern, so it can be
 *  wrong both ways: `src/gridsys` has no extension and passes. */
export function filePaths(text: string): Array<{ path: string; line: number }> {
  const out: Array<{ path: string; line: number }> = []
  text.split('\n').forEach((l, i) => {
    for (const raw of l.split(/[\s`'"()<>[\]{},;]+/)) {
      const token = raw.replace(/[.:!?]+$/, '')
      if (!token || URL_LIKE.test(token) || !PATH_LIKE.test(token) || !PATH_END.test(token)) continue
      out.push({ path: token, line: i + 1 })
    }
  })
  return out
}

/** A module name that reads as a path: a slash, or a file extension at its end. Stricter than
 *  the whole-file pattern, because a module name has no reason to hold either. */
const moduleIsPath = (name: string) => /[/\\]/.test(name) || PATH_END.test(name)

/** #st-build-parallel: two tickets overlap when their module names share one, compared after
 *  trim and case-folding only. A ticket that names none may touch anything, so it overlaps
 *  every ticket and builds alone. */
export function touchesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true
  const names = new Set(a.map((x) => x.trim().toLowerCase()))
  return b.some((x) => names.has(x.trim().toLowerCase()))
}

/** The checks on one ticket (#st-ticket-own-checks). A ticket that fails one is not put on the
 *  board. `text` is the whole file: size and file paths read it, not the parse. */
export function checkTicket(t: ParsedTicket, text: string): TicketCheck[] {
  const chars = text.length
  const missing = missingShape(text)
  const notMake = t.checks.filter((c) => !isMakeCheck(c))
  const pathNames = t.touches.filter(moduleIsPath)
  const lines = text.split('\n')
  const filesLine = lines.findIndex((l) => l.startsWith('files:'))
  const paths = [
    ...(filesLine >= 0 ? [`a "files:" line (line ${filesLine + 1})`] : []),
    ...filePaths(text).map((p) => `${p.path} (line ${p.line})`),
  ]
  return [
    { file: t.file, check: 'title', ok: true, detail: t.title },
    {
      file: t.file,
      check: 'shape',
      ok: missing.length === 0,
      detail: missing.length ? `missing (#st-ticket-shape): ${missing.join(', ')}` : 'every header line and section is there',
    },
    { file: t.file, check: 'size', ok: chars <= MAX_TICKET_CHARS, detail: `${chars} chars` },
    { file: t.file, check: 'what-to-build', ok: t.whatToBuild.length > 0, detail: t.whatToBuild ? 'says what to build' : 'no "What to build" section' },
    { file: t.file, check: 'acceptance', ok: t.acceptance.length > 0, detail: `${t.acceptance.length} acceptance criteria` },
    { file: t.file, check: 'no-file-paths', ok: paths.length === 0, detail: paths.length ? `names file paths: ${paths.join(', ')}` : 'names no file paths' },
    {
      file: t.file,
      check: 'make-targets',
      ok: notMake.length === 0,
      detail: notMake.length ? `not a make target (#lp-checks-scripts): ${notMake.join(', ')}` : 'every check is a make target',
    },
    {
      file: t.file,
      check: 'touches',
      ok: t.touches.length > 0 && pathNames.length === 0,
      detail:
        t.touches.length === 0
          ? 'no "touches:" module names (#st-build-parallel)'
          : pathNames.length
            ? `a module name is a file path: ${pathNames.join(', ')}`
            : `touches ${t.touches.join(', ')}`,
    },
  ]
}

/** Parse one ticket file and run its own checks. A file with no title line is not parsed, so
 *  it gets only the title result (#st-ticket-own-checks). */
export function checkTicketFile(file: string, text: string): { ticket?: ParsedTicket; checks: TicketCheck[] } {
  const ticket = parseTicket(file, text)
  if (!ticket) return { checks: [{ file, check: 'title', ok: false, detail: 'no title line' }] }
  return { ticket, checks: checkTicket(ticket, text) }
}

/** Whether `from` waits for `target` along blocked_by, directly or through other blockers. */
function reaches(byNum: Map<number, ParsedTicket>, from: number, target: number): boolean {
  const seen = new Set<number>()
  const stack = [...(byNum.get(from)?.blockedBy ?? [])]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n === target) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(byNum.get(n)?.blockedBy ?? []))
  }
  return false
}

/** The tickets that sit on a blocked_by cycle: each one reaches itself. */
function onCycle(tickets: ParsedTicket[]): number[] {
  const byNum = new Map(tickets.map((t) => [t.num, t]))
  return tickets.filter((t) => reaches(byNum, t.num, t.num)).map((t) => t.num)
}

/** The checks on the whole set (#st-ticket-set-checks): every card cited, every story
 *  delivered, and blocked_by naming real tickets with no cycle. The order itself is the
 *  planner's, so blocked_by is not compared with depends_on. */
export function checkTicketSet(tickets: ParsedTicket[], ctx: { cardIds: string[]; stories: number[] }): TicketCheck[] {
  const checks: TicketCheck[] = []
  const cited = new Set(tickets.flatMap((t) => t.cites))
  const missing = ctx.cardIds.filter((id) => !cited.has(id))
  checks.push({
    file: '(coverage)',
    check: 'cards-cited',
    ok: missing.length === 0,
    detail: missing.length === 0 ? 'every decided card is cited' : `not cited: ${missing.join(', ')}`,
  })

  const delivered = new Set(tickets.flatMap((t) => t.stories))
  const undelivered = ctx.stories.filter((n) => !delivered.has(n))
  const unknown = [...delivered].filter((n) => !ctx.stories.includes(n))
  checks.push({
    file: '(stories)',
    check: 'stories',
    ok: undelivered.length === 0 && unknown.length === 0,
    detail: undelivered.length
      ? `not delivered: ${undelivered.join(', ')}`
      : unknown.length
        ? `not in the spec: ${unknown.join(', ')}`
        : `every one of ${ctx.stories.length} stories is delivered`,
  })

  // Check 3 names tickets, so a failure blocks only those (#st-ticket-partial).
  const cycle = onCycle(tickets)
  const known = new Set(tickets.map((t) => t.num))
  const dangling = tickets.flatMap((t) => t.blockedBy.filter((b) => !known.has(b)).map((b) => ({ ticket: t, b })))
  const problems = [
    ...(cycle.length ? ['blocked_by has a cycle'] : []),
    ...(dangling.length ? [`no such ticket: ${dangling.map((d) => `${d.ticket.file} → ${d.b}`).join(', ')}`] : []),
  ]
  const named = [...new Set([...cycle, ...dangling.map((d) => d.ticket.num)])].sort((a, b) => a - b)
  checks.push({
    file: '(blocked_by)',
    check: 'blocked_by',
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ') : 'every blocker exists, no cycle',
    ...(named.length ? { tickets: named } : {}),
  })
  return checks
}

/**
 * The checks on a folder's worth of ticket files, with no plan around them: each file's own
 * checks, then the set checks over the files that passed their own (#st-ticket-set-checks).
 * `werk plan` runs the same two functions, so the two never disagree on a ticket.
 */
export function checkTicketFiles(
  files: Array<{ name: string; text: string }>,
  ctx: { cardIds: string[]; stories: number[] },
): TicketCheck[] {
  const own = files.map((f) => checkTicketFile(f.name, f.text))
  const passed = own.filter((o) => o.ticket && o.checks.every((c) => c.ok)).map((o) => o.ticket!)
  return [...checkTicketSet(passed, ctx), ...own.flatMap((o) => o.checks)]
}
