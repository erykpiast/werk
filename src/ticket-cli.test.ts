// `werk ticket <verb>`: the agent's side of the board (#werk-board-control). Most tests call
// ticketCommand on a scratch board; the exit-code tests run the real command line.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { ticketCommand } from './ticket-cli.ts'
import { cli, scratchDir } from './test/harness.ts'

/** A scratch board with run r (01, 02 blocked by 01, 03) and run s (01). */
function scratch() {
  const dir = scratchDir('werk-ticket-cli-')
  const board = join(dir, '.werk', 'board.jsonl')
  const tickets = join(dir, '.werk', 'tickets')
  mkdirSync(join(tickets, 'r'), { recursive: true })
  const plan = (id: string, run: string, blockedBy: string[] = []) =>
    appendBoard('ticket.planned', { id, run, file: `${id}.md`, title: `T ${id}`, blockedBy }, { path: board })
  plan('r/01', 'r')
  plan('r/02', 'r', ['r/01'])
  plan('r/03', 'r')
  plan('s/01', 's')
  const run = (positional: string[], flags: Record<string, string | true> = {}) => ticketCommand(positional, flags, 'agent', { board, tickets })
  const fold = () => foldBoard(readBoard(board))
  const raw = () => (existsSync(board) ? readFileSync(board, 'utf8') : '')
  return { dir, board, tickets, run, fold, raw }
}

describe('list', () => {
  test('every column with its count, archived ones in their own section, --run filters', () => {
    const s = scratch()
    appendBoard('ticket.archived', { id: 'r/03' }, { path: s.board })
    const out = s.run(['list'])
    expect(out.filter((l) => !l.startsWith('  '))).toEqual(['blocked (1)', 'ready (2)', 'building (0)', 'merging (0)', 'done (0)', 'archived (1)'])
    expect(out[out.indexOf('ready (2)') + 1]).toContain('r/01')
    expect(out.at(-1)).toContain('r/03')
    expect(out.at(-1)).toContain('[archived]')
    expect(out.join('\n')).toContain('s/01')

    const only = s.run(['list'], { run: 's' })
    expect(only.filter((l) => !l.startsWith('  '))).toEqual(['blocked (0)', 'ready (1)', 'building (0)', 'merging (0)', 'done (0)'])
    expect(only.join('\n')).not.toContain('r/0')
  })

  test('a missing board.jsonl reads as an empty board', () => {
    const dir = scratchDir('werk-ticket-cli-')
    const board = join(dir, 'none', 'board.jsonl')
    expect(ticketCommand(['list'], {}, 'agent', { board, tickets: join(dir, 't') })).toEqual([
      'blocked (0)', 'ready (0)', 'building (0)', 'merging (0)', 'done (0)',
    ])
    expect(existsSync(board)).toBe(false)
  })
})

describe('move', () => {
  test('moves between blocked and ready with the trimmed reason, as the given actor', () => {
    const s = scratch()
    expect(s.run(['move', 'r/03', 'blocked'], { reason: '  waits on the schema  ' })).toEqual(['r/03: ready → blocked'])
    const e = readBoard(s.board).at(-1)!
    expect([e.type, e.actor]).toEqual(['ticket.moved', 'agent'])
    expect(e.payload).toEqual({ id: 'r/03', to: 'blocked', reason: 'waits on the schema' })
    expect(s.fold().tickets.get('r/03')!.column).toBe('blocked')
  })

  test('refuses a missing or blank reason, another column, and a move out of building', () => {
    const s = scratch()
    const before = s.raw()
    expect(() => s.run(['move', 'r/03', 'blocked'])).toThrow('needs --reason')
    expect(() => s.run(['move', 'r/03', 'blocked'], { reason: '   ' })).toThrow('needs --reason')
    expect(() => s.run(['move', 'r/03', 'blocked'], { reason: true })).toThrow('needs --reason')
    expect(() => s.run(['move', 'r/03', 'building'], { reason: 'x' })).toThrow('takes blocked or ready')
    expect(() => s.run(['move', 'r/03', 'ready'], { reason: 'x' })).toThrow('already in ready')
    appendBoard('ticket.moved', { id: 'r/01', to: 'building' }, { path: s.board })
    const mid = s.raw()
    expect(() => s.run(['move', 'r/01', 'ready'], { reason: 'x' })).toThrow('only the merge loop moves it')
    expect(s.raw()).toBe(mid)
    expect(mid.startsWith(before)).toBe(true)
  })
})

describe('archive and restore', () => {
  test('archive takes a ready or blocked ticket, and restore puts it back', () => {
    const s = scratch()
    expect(s.run(['archive', 'r/02'])[0]).toContain('werk ticket restore r/02')
    expect(s.fold().tickets.get('r/02')!.archived).toBe(true)
    expect(s.run(['restore', 'r/02'])).toEqual(['restored r/02 to blocked'])
    expect(s.fold().tickets.get('r/02')!.archived).toBe(false)
  })

  test('archive takes a building ticket too, and it stays in building, archived (#werk-board-control)', () => {
    const s = scratch()
    appendBoard('ticket.moved', { id: 'r/01', to: 'building' }, { path: s.board })
    expect(s.run(['archive', 'r/01'])[0]).toContain('werk ticket restore r/01')
    expect(s.fold().tickets.get('r/01')).toMatchObject({ archived: true, column: 'building' })
  })

  test('archive refuses merging, done, and an already archived ticket', () => {
    const s = scratch()
    appendBoard('ticket.moved', { id: 'r/03', to: 'merging' }, { path: s.board })
    appendBoard('ticket.moved', { id: 's/01', to: 'done' }, { path: s.board })
    appendBoard('ticket.archived', { id: 'r/02' }, { path: s.board })
    const before = s.raw()
    expect(() => s.run(['archive', 'r/03'])).toThrow('r/03 is in merging')
    expect(() => s.run(['archive', 's/01'])).toThrow('s/01 is in done')
    expect(() => s.run(['archive', 'r/02'])).toThrow('already archived')
    expect(s.raw()).toBe(before)
  })

  test('restore refuses a ticket that is not archived', () => {
    const s = scratch()
    const before = s.raw()
    expect(() => s.run(['restore', 'r/01'])).toThrow('r/01 is not archived')
    expect(s.raw()).toBe(before)
  })
})

describe('import', () => {
  test('is idempotent, and keeps a ticket that fails its own checks off the board (#st-ticket-partial)', () => {
    const s = scratch()
    const dir = join(s.tickets, 'n')
    mkdirSync(dir, { recursive: true })
    const body = (blocked = '') => `cites:\nblocked_by: ${blocked}\nstories:\ntouches: the module\n## What to build\n\nIt.\n\n## Acceptance criteria\n\n- [ ] works\n\n## Checks\n`
    writeFileSync(join(dir, '01.md'), `title: One\n${body()}`)
    writeFileSync(join(dir, '02.md'), `title: Two\n${body('1')}`)
    writeFileSync(join(dir, '03.md'), 'no title here\n')
    writeFileSync(join(dir, '04.md'), `title: Four\n${body()}\n- \`bun test\`\n`)
    expect(s.run(['import', 'n'])).toEqual([
      'imported 2 of 4 ticket(s) from n, 2 failed their own checks',
      '  03.md: title: no title line',
      '  04.md: make-targets: not a make target (#lp-checks-scripts): bun test',
    ])
    expect(s.fold().tickets.get('n/02')).toMatchObject({ title: 'Two', blockedBy: ['n/01'], column: 'blocked' })
    expect(s.fold().tickets.has('n/04')).toBe(false)
    const after = s.raw()
    expect(s.run(['import', 'n'])[0]).toBe('imported 0 of 4 ticket(s) from n, 2 on the board already, 2 failed their own checks')
    expect(s.raw()).toBe(after)
  })

  test('refuses a run id that is a path, before it reads anything', () => {
    const s = scratch()
    mkdirSync(join(s.dir, '.werk', 'x'), { recursive: true })
    writeFileSync(join(s.dir, '.werk', 'x', '01.md'), 'title: Outside\n\nx\n')
    const before = s.raw()
    expect(() => s.run(['import', '../x'])).toThrow('not a plan run id')
    expect(s.raw()).toBe(before)
  })
})

describe('the command line', () => {
  /** `werk ticket ...` as its own process, on the scratch board and tickets folder. */
  const werk = (s: ReturnType<typeof scratch>, ...args: string[]) =>
    cli(['ticket', ...args], { cwd: s.dir, log: join(s.dir, '.werk', 'log.jsonl'), env: { WERK_BOARD: s.board, WERK_TICKETS: s.tickets } })

  test('an unknown verb, an unknown id, and a missing run folder exit 1 and write nothing', () => {
    const s = scratch()
    const before = s.raw()
    const verb = werk(s, 'frobnicate')
    expect([verb.code, verb.stderr]).toEqual([1, expect.stringContaining('unknown ticket verb "frobnicate"')])
    const id = werk(s, 'archive', 'r/99')
    expect([id.code, id.stderr]).toEqual([1, expect.stringContaining('no ticket with the id "r/99"')])
    const run = werk(s, 'import', 'nope')
    expect([run.code, run.stderr]).toEqual([1, expect.stringContaining('no ticket files in')])
    expect(s.raw()).toBe(before)
  })

  test('a verb that works exits 0 and prints its lines', () => {
    const s = scratch()
    const r = werk(s, 'list', '--run', 's')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('ready (1)')
  })
})
