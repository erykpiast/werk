/** Shared setup for the board held-out tests of tickets 81, 88, 89, 90 and 108. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

/** Green on a builder branch. On the merge queue's detached tree it waits `mergeSleep` seconds, then is green. */
export const makefile = (mergeSleep = 0, passSleep = 0) =>
  [
    'check:',
    `\t@if ! git symbolic-ref -q HEAD >/dev/null; then sleep ${mergeSleep}; else sleep ${passSleep}; fi`,
    '',
  ].join('\n')

export const ticketOf = (number: number, fields: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...fields,
})

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
export { git }

/**
 * Turns a project directory into one whose main line holds a Makefile with a `check` target,
 * whose map holds a decided root card "root" with a decided child "loop", and whose board holds
 * the given tickets in ready. The .werk folder is not tracked.
 */
export function runProject(dir: string, tickets: TicketFields[], make = makefile()) {
  writeFileSync(join(dir, 'Makefile'), make)
  writeFileSync(join(dir, 'notes.txt'), 'notes\n')
  writeFileSync(join(dir, '.gitignore'), '.werk/\n')
  spawnSync('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.werk'], { cwd: dir })
  git(dir, 'add', 'Makefile', 'notes.txt', '.gitignore')
  git(dir, '-c', 'user.name=werk test', '-c', 'user.email=test@werk.invalid', 'commit', '--quiet', '-m', 'Add the check')
  const werk = join(dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), accepted('root'), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(werk, 'board.jsonl'), '')
  appendBoard(dir, ...tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
}

let seq = 1000
export function appendBoard(dir: string, ...events: NewBoardEvent[]) {
  for (const e of events)
    appendFileSync(join(dir, '.werk', 'board.jsonl'), JSON.stringify({ ...e, seq: seq++, at: new Date().toISOString(), actor: 'agent' }) + '\n')
}

export const boardEvents = (dir: string): BoardEvent[] =>
  readFileSync(join(dir, '.werk', 'board.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BoardEvent)

export const columnOf = (dir: string, n: number, events = boardEvents(dir)) =>
  foldBoard(events).columns.find((c) => c.tickets.some((t) => t.number === n))?.name

export const movesOf = (dir: string, n: number) =>
  boardEvents(dir).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
/** A builder pass that waits for a file before it writes its own file and ends. */
export const gated = (gate: string, path: string): FakeReply => ({ steps: [{ waitFor: gate }, ...writes(path).steps] })
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
export const author = reply({ steps: [{ text: STEP }] })
export const greenBinder = (tickets: number[]) => reply({ steps: tickets.map((n) => ({ id: `${n}.1`, cmd: 'true' })) })
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
export const runScript = (builder: FakeReply[], tickets: number[]): FakeScript => ({
  steps: [],
  roles: { ...judges(), builder, 'heldout-author': author, 'heldout-binder': [greenBinder(tickets)] },
})

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
