import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from './project.ts'
import {
  appendBoard,
  agentMove,
  buildRefusal,
  canArchive,
  checkReorder,
  columns,
  endUnfinishedWork,
  foldBoard,
  manualMove,
  readBoard,
  buildHolder,
  restartLines,
  restartPlan,
  restartRefusal,
  resumeRefusal,
  runHolder,
  runInProgress,
  signalBuild,
  startRefusal,
  unfinishedWork,
  type BoardEvent,
  type BoardEventMap,
  type BoardEventType,
} from './board.ts'

/** A board log, written the way appendBoard writes one. */
function log(...events: Array<{ [T in BoardEventType]: [T, BoardEventMap[T]] }[BoardEventType]>): BoardEvent[] {
  return events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }) as BoardEvent)
}

const planned = (id: string, blockedBy: string[] = []) =>
  ['ticket.planned', { id, run: 'r', file: `${id}.md`, title: id, blockedBy }] as ['ticket.planned', BoardEventMap['ticket.planned']]

describe('foldBoard', () => {
  test('a planned ticket enters ready, or blocked when it has a blocker', () => {
    const b = foldBoard(log(planned('a'), planned('b', ['a'])))
    expect(b.tickets.get('a')!.column).toBe('ready')
    expect(b.tickets.get('b')!.column).toBe('blocked')
    expect(b.tickets.get('b')!.openBlockers).toEqual(['a'])
    expect(b.seq).toBe(2)
  })

  test('a blocker that reaches done no longer counts as open', () => {
    const b = foldBoard(log(planned('a'), planned('b', ['a']), ['ticket.moved', { id: 'a', to: 'done' }]))
    expect(b.tickets.get('b')!.openBlockers).toEqual([])
  })

  test('a failed set check holds a ticket until a move to ready (#st-ticket-partial)', () => {
    const hold = ['ticket.moved', { id: 'a', to: 'blocked', reason: 'set check blocked_by failed: x', check: 'blocked_by' }] as const
    expect(foldBoard(log(planned('a'), [...hold])).tickets.get('a')!.heldBy).toBe('blocked_by')
    // A move within blocked without a check keeps the hold.
    const again = ['ticket.moved', { id: 'a', to: 'blocked', reason: 'still wrong' }] as const
    expect(foldBoard(log(planned('a'), [...hold], [...again])).tickets.get('a')!.heldBy).toBe('blocked_by')
    const lifted = foldBoard(log(planned('a'), [...hold], ['ticket.moved', { id: 'a', to: 'ready', reason: 'the set check passes' }]))
    expect(lifted.tickets.get('a')!.heldBy).toBeUndefined()
  })

  test('a move keeps its reason, and leaving building ends the pulse', () => {
    const b = foldBoard(
      log(
        planned('a'),
        ['ticket.build.started', { id: 'a', loopRun: 'L1', log: 'l.jsonl' }],
        ['ticket.moved', { id: 'a', to: 'building' }],
        ['ticket.moved', { id: 'a', to: 'ready', reason: 'unblocked by hand' }],
      ),
    )
    const t = b.tickets.get('a')!
    expect([t.column, t.reason, t.live, t.loopRun, t.log]).toEqual(['ready', 'unblocked by hand', false, 'L1', 'l.jsonl'])
  })

  test('since is when the ticket entered its column: a move within the column keeps it', () => {
    const toBuilding = ['ticket.moved', { id: 'a', to: 'building' }] as const
    const started = ['ticket.build.started', { id: 'a', loopRun: 'L1' }] as const
    const ended = ['ticket.build.ended', { id: 'a', loopRun: 'L1', result: 'error' }] as const
    const fold = (...e: Parameters<typeof log>) => foldBoard(log(...e)).tickets.get('a')!
    expect(fold(planned('a')).since).toBe('t0')
    const live = fold(planned('a'), [...toBuilding], [...started])
    expect([live.since, live.liveSince]).toEqual(['t1', 't2'])
    const again = fold(planned('a'), [...toBuilding], [...started], [...ended], [...toBuilding])
    expect([again.since, again.liveSince]).toEqual(['t1', undefined])
  })

  test('a live session keeps the build pid; ending it or leaving building drops it', () => {
    const started = ['ticket.build.started', { id: 'a', loopRun: 'L1', pid: 4242, group: true }] as const
    const live = foldBoard(log(planned('a'), ['ticket.moved', { id: 'a', to: 'building' }], [...started])).tickets.get('a')!
    expect([live.pid, live.pidGroup]).toEqual([4242, true])
    const ended = foldBoard(log(planned('a'), [...started], ['ticket.build.ended', { id: 'a', loopRun: 'L1', result: 'stopped' }])).tickets.get('a')!
    expect([ended.pid, ended.pidGroup]).toEqual([undefined, undefined])
    const moved = foldBoard(log(planned('a'), [...started], ['ticket.moved', { id: 'a', to: 'ready' }])).tickets.get('a')!
    expect([moved.pid, moved.pidGroup]).toEqual([undefined, undefined])
    const plain = foldBoard(log(planned('a'), ['ticket.build.started', { id: 'a', loopRun: 'L1', pid: 7 }])).tickets.get('a')!
    expect([plain.pid, plain.pidGroup]).toEqual([7, false])
    const none = foldBoard(log(planned('a'), ['ticket.build.started', { id: 'a', loopRun: 'L1' }])).tickets.get('a')!
    expect([none.pid, none.pidGroup]).toEqual([undefined, undefined])
  })

  test('entering building without a reason drops the old one; with one, keeps it', () => {
    const refused = ['ticket.moved', { id: 'a', to: 'ready', reason: 'the build refused: x' }] as const
    expect(foldBoard(log(planned('a'), [...refused])).tickets.get('a')!.reason).toBe('the build refused: x')
    expect(foldBoard(log(planned('a'), [...refused], ['ticket.moved', { id: 'a', to: 'building' }])).tickets.get('a')!.reason).toBeUndefined()
    const red = foldBoard(log(planned('a'), [...refused], ['ticket.moved', { id: 'a', to: 'building', reason: 'red on the run tree' }]))
    expect(red.tickets.get('a')!.reason).toBe('red on the run tree')
    expect(foldBoard(log(planned('a'), [...refused], ['ticket.moved', { id: 'a', to: 'done' }])).tickets.get('a')!.reason).toBe('the build refused: x')
  })

  test('a build session counts passes and records how it ended', () => {
    const b = foldBoard(
      log(
        planned('a'),
        ['ticket.build.started', { id: 'a', loopRun: 'L1' }],
        ['ticket.pass', { id: 'a', loopRun: 'L1', pass: 1, green: false }],
        ['ticket.pass', { id: 'a', loopRun: 'L1', pass: 2, green: true }],
        ['ticket.build.ended', { id: 'a', loopRun: 'L1', result: 'green' }],
      ),
    )
    const t = b.tickets.get('a')!
    expect([t.passes, t.live, t.lastEnd]).toEqual([2, false, 'green'])
  })

  test('a red held-out run marks the ticket and names what failed', () => {
    const b = foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: false, failed: ['t1'], followUp: 'r/09' }]))
    const t = b.tickets.get('a')!
    expect([t.heldOutRed, t.heldOutFailed, t.followUp]).toEqual([true, ['t1'], 'r/09'])
    const green = foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: true }])).tickets.get('a')!
    expect([green.heldOutRed, green.heldOutFailed]).toEqual([false, []])
  })

  test('a step the binder could not run is not run, not red (#st-heldout-notrun)', () => {
    const notRun = foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: false, binderErrors: ['01.1 x: timed out'] }])).tickets.get('a')!
    expect([notRun.heldOutRed, notRun.heldOutNotRun, notRun.followUp]).toEqual([false, ['01.1 x: timed out'], undefined])
    // A real failure beside a not-run step is still red, and both lists are kept.
    const both = foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: false, failed: ['01.2 y'], binderErrors: ['01.1 x: timed out'] }])).tickets.get('a')!
    expect([both.heldOutRed, both.heldOutFailed, both.heldOutNotRun]).toEqual([true, ['01.2 y'], ['01.1 x: timed out']])
    // A red result that names neither kind stays red.
    expect(foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: false }])).tickets.get('a')!.heldOutRed).toBe(true)
    // A later green run clears it.
    const later = foldBoard(log(planned('a'), ['ticket.heldout', { id: 'a', green: false, binderErrors: ['01.1 x: y'] }], ['ticket.heldout', { id: 'a', green: true }])).tickets.get('a')!
    expect(later.heldOutNotRun).toEqual([])
  })

  test('conflicts count in total and in a row; any other merge result ends the row (#st-build-conflict)', () => {
    const conflict = ['ticket.merge', { id: 'a', green: false, conflict: true }] as ['ticket.merge', BoardEventMap['ticket.merge']]
    const red = ['ticket.merge', { id: 'a', green: false, cmd: 'make test', code: 2 }] as ['ticket.merge', BoardEventMap['ticket.merge']]
    const t = foldBoard(log(planned('a'), conflict, conflict, red, conflict)).tickets.get('a')!
    expect([t.conflicts, t.conflictStreak]).toEqual([3, 1])
    expect(foldBoard(log(planned('a'), conflict, conflict)).tickets.get('a')!.conflictStreak).toBe(2)
  })

  test('a move back to ready by a stopped loop carries its end until the ticket leaves ready (#st-build-stop-ready)', () => {
    const stopped = ['ticket.moved', { id: 'a', to: 'ready', reason: 'the merge loop stopped: stuck — a: cap', loopStop: 'stuck' }] as ['ticket.moved', BoardEventMap['ticket.moved']]
    const t = foldBoard(log(planned('a'), ['ticket.moved', { id: 'a', to: 'building' }], stopped)).tickets.get('a')!
    expect(t).toMatchObject({ column: 'ready', loopStop: 'stuck', reason: 'the merge loop stopped: stuck — a: cap' })
    const again = foldBoard(log(planned('a'), stopped, ['ticket.moved', { id: 'a', to: 'building' }])).tickets.get('a')!
    expect(again.loopStop).toBeUndefined()
  })

  test('the project has no target until one is set, and the last one holds (#st-build-target)', () => {
    expect(foldBoard(log()).target).toBeUndefined()
    const b = foldBoard(log(['project.target', { repo: '/a' }], ['project.target', { repo: '/b' }]))
    expect(b.target).toBe('/b')
  })

  test('archive and restore flip archived', () => {
    expect(foldBoard(log(planned('a'), ['ticket.archived', { id: 'a' }])).tickets.get('a')!.archived).toBe(true)
    expect(foldBoard(log(planned('a'), ['ticket.archived', { id: 'a' }], ['ticket.restored', { id: 'a' }])).tickets.get('a')!.archived).toBe(false)
  })

  test('an event for an unknown ticket changes nothing', () => {
    const b = foldBoard(
      log(
        ['ticket.moved', { id: 'x', to: 'done' }],
        ['ticket.archived', { id: 'x' }],
        ['ticket.build.started', { id: 'x', loopRun: 'L' }],
        ['ticket.pass', { id: 'x', loopRun: 'L', pass: 1, green: true }],
        ['ticket.build.ended', { id: 'x', loopRun: 'L', result: 'red' }],
        ['ticket.heldout', { id: 'x', green: false }],
        ['ticket.reordered', { ids: ['x'] }],
      ),
    )
    expect(b.tickets.size).toBe(0)
  })
})

describe('plans (#vi-board-plan)', () => {
  test('a plan is creating while it runs, records its steps and logs, then follows its tickets', () => {
    const events = log(
      ['plan.started', { run: 'r', pid: 7 }],
      ['plan.step', { run: 'r', step: 'spec', log: 's.jsonl' }],
      ['plan.step', { run: 'r', step: 'tickets', log: 't.jsonl' }],
      ['plan.step', { run: 'r', step: 'checks' }],
    )
    const running = foldBoard(events).plans.get('r')!
    expect(running).toMatchObject({ live: true, pid: 7, step: 'checks', state: 'creating', startedAt: 't0' })
    expect(running.logs).toEqual([{ step: 'spec', path: 's.jsonl' }, { step: 'tickets', path: 't.jsonl' }])

    const ended = log(
      ...events.map((e) => [e.type, e.payload] as any),
      planned('a'),
      planned('b'),
      ['plan.ended', { run: 'r', result: 'ok', planned: ['a', 'b'], archived: [] }],
    )
    const p = foldBoard(ended).plans.get('r')!
    expect(p).toMatchObject({ live: false, pid: undefined, result: 'ok', planned: ['a', 'b'], state: 'building', tickets: ['a', 'b'] })
    const done = [...ended, ...log(['ticket.moved', { id: 'a', to: 'done' }], ['ticket.archived', { id: 'b' }]).map((e, i) => ({ ...e, seq: 100 + i }))]
    expect(foldBoard(done).plans.get('r')!.state).toBe('done')
  })

  test('a plan that did not end ok is stopped with its reason; the next plan starts clean', () => {
    const stopped = log(
      ['plan.started', { run: 'r' }],
      ['plan.ended', { run: 'r', result: 'agent-error', step: 'spec', detail: 'timed out' }],
    )
    expect(foldBoard(stopped).plans.get('r')).toMatchObject({ state: 'stopped', result: 'agent-error', failedStep: 'spec', detail: 'timed out' })
    const again = log(...stopped.map((e) => [e.type, e.payload] as any), ['plan.started', { run: 'r' }])
    expect(foldBoard(again).plans.get('r')).toMatchObject({ state: 'creating', result: undefined, failedStep: undefined, detail: undefined, logs: [] })
  })

  test('tickets planned before plans were recorded still get a plan card', () => {
    const p = foldBoard(log(planned('a'))).plans.get('r')!
    expect(p).toMatchObject({ live: false, state: 'building', tickets: ['a'] })
    expect(p.startedAt).toBeUndefined()
  })
})

describe('columns', () => {
  test('groups by column in hand order, ties by id, archived left out', () => {
    const b = foldBoard(
      log(planned('a'), planned('b'), planned('c'), planned('z'), ['ticket.reordered', { ids: ['c', 'a', 'b'] }], ['ticket.archived', { id: 'z' }]),
    )
    // z kept order 3 from planning; c, a, b were reordered to 0, 1, 2.
    expect(columns(b).ready.map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(columns(b).done).toEqual([])
  })

  test('two tickets with the same rank sort by id', () => {
    const b = foldBoard(log(planned('b'), planned('a'), ['ticket.reordered', { ids: ['b'] }], ['ticket.reordered', { ids: ['a'] }]))
    expect(columns(b).ready.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('the moves a person may make', () => {
  const board = foldBoard(
    log(
      planned('free'),
      planned('dep'),
      planned('held', ['dep']),
      ['ticket.moved', { id: 'held', to: 'ready', reason: 'agent says go' }],
      planned('built'),
      ['ticket.moved', { id: 'built', to: 'building' }],
      planned('gone'),
      ['ticket.archived', { id: 'gone' }],
    ),
  )
  const t = (id: string) => board.tickets.get(id)!

  test('ready to building, when nothing blocks it', () => {
    expect(manualMove(t('free'), 'building')).toEqual({ ok: true })
  })
  test('ready to building is refused while a blocker is open, and names it', () => {
    expect(manualMove(t('held'), 'building')).toEqual({ ok: false, why: 'blocked by dep' })
  })
  test('building back to ready is refused: archiving the ticket ends a build (#werk-board-control)', () => {
    expect(manualMove(t('built'), 'ready')).toEqual({ ok: false, why: 'a build is not stopped in place: archive its ticket to end it' })
  })
  test('nothing else, and never an archived ticket', () => {
    expect(manualMove(t('free'), 'done')).toEqual({ ok: false, why: 'ready → done is not a person\'s move' })
    expect(manualMove(t('gone'), 'building').ok).toBe(false)
  })
  test('archive is offered on a ready, blocked or building ticket', () => {
    expect([canArchive(t('free')), canArchive(t('built')), canArchive(t('gone'))]).toEqual([true, true, false])
  })
})

describe('board.jsonl', () => {
  test('appendBoard numbers events and readBoard reads them back', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-board-')), 'b', 'board.jsonl')
    expect(readBoard(path)).toEqual([])
    appendBoard('ticket.planned', { id: 'a', run: 'r', file: 'f', title: 'a', blockedBy: [] }, { path })
    const e = appendBoard('ticket.moved', { id: 'a', to: 'building' }, { path, actor: 'you', at: 'now' })
    expect([e.seq, e.actor, e.at]).toEqual([2, 'you', 'now'])
    expect(foldBoard(readBoard(path)).tickets.get('a')!.column).toBe('building')
  })

  test('a broken line names its file and line', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-board-')), 'board.jsonl')
    writeFileSync(path, '{bad\n')
    expect(() => readBoard(path)).toThrow(`${path}:1 is not valid JSON`)
  })

  test('defaults to the scratch WERK_BOARD', () => {
    expect(paths.board).toBe(process.env.WERK_BOARD!)
    appendBoard('ticket.archived', { id: 'nothing' })
    expect(readBoard().length).toBeGreaterThan(0)
  })
})

// ---- the board's rules for a person's drag and an agent's move (#werk-board-control) ----

/** A loosely typed board log, for the rule tests below. */
function rlog(...events: Array<[BoardEventType, unknown]>): BoardEvent[] {
  return events.map(([type, payload], i) => ({
    seq: i + 1,
    at: `2026-10-03T10:${String(i).padStart(2, '0')}:00.000Z`,
    actor: 'agent' as const,
    type,
    payload: payload as BoardEventMap[BoardEventType],
  }))
}

const rplanned = (id: string, blockedBy: string[] = []): [BoardEventType, unknown] => [
  'ticket.planned',
  { id, run: 'r', file: `.werk/tickets/${id}.md`, title: `title ${id}`, blockedBy },
]
const rmoved = (id: string, to: string, reason?: string): [BoardEventType, unknown] => ['ticket.moved', { id, to, reason }]

describe('the person\'s moves', () => {
  const board = foldBoard(rlog(rplanned('r/01'), rplanned('r/02', ['r/01']), rplanned('r/03'), rmoved('r/03', 'building'), rplanned('r/04'), rmoved('r/04', 'done')))
  const t = (id: string) => board.tickets.get(id)!

  test('ready → building is a trigger, refused while a blocker is open', () => {
    expect(manualMove(t('r/01'), 'building').ok).toBe(true)
    const blocked = foldBoard(rlog(rplanned('r/01'), rplanned('r/02', ['r/01']), rmoved('r/02', 'ready')))
    expect(manualMove(blocked.tickets.get('r/02')!, 'building')).toEqual({ ok: false, why: 'blocked by r/01' })
  })

  test('every move other than the trigger is refused, building → ready included', () => {
    expect(manualMove(t('r/03'), 'ready').ok).toBe(false)
    expect(manualMove(t('r/03'), 'done').ok).toBe(false)
    expect(manualMove(t('r/04'), 'ready').ok).toBe(false)
    expect(manualMove(t('r/02'), 'ready').ok).toBe(false)
  })

  test('archive is offered on ready, blocked and building, not on done', () => {
    expect([t('r/01'), t('r/02'), t('r/03'), t('r/04')].map(canArchive)).toEqual([true, true, true, false])
    const archived = foldBoard(rlog(rplanned('r/01'), ['ticket.archived', { id: 'r/01' }])).tickets.get('r/01')!
    expect(canArchive(archived)).toBe(false)
    expect(manualMove(archived, 'building').ok).toBe(false)
  })

  test('a reorder must name exactly the ready tickets', () => {
    expect(checkReorder(board, ['r/01']).ok).toBe(true)
    expect(checkReorder(board, ['r/01', 'r/03']).ok).toBe(false)
    expect(checkReorder(board, []).ok).toBe(false)
    expect(checkReorder(board, ['r/01', 'r/01']).ok).toBe(false)
  })
})

describe('agentMove', () => {
  const board = foldBoard(rlog(rplanned('r/01'), rplanned('r/02', ['r/01']), rplanned('r/03'), rmoved('r/03', 'building')))
  const t = (id: string) => board.tickets.get(id)!

  test('moves between blocked and ready with a reason', () => {
    expect(agentMove(t('r/01'), 'blocked', 'needs the schema').ok).toBe(true)
    expect(agentMove(t('r/02'), 'ready', 'r/01 is not needed after all').ok).toBe(true)
  })

  test('refuses a missing reason, a same-column move, other columns, and archived tickets', () => {
    expect(agentMove(t('r/01'), 'blocked', '  ').ok).toBe(false)
    expect(agentMove(t('r/01'), 'ready', 'x').ok).toBe(false)
    expect(agentMove(t('r/01'), 'building', 'x').ok).toBe(false)
    expect(agentMove(t('r/03'), 'ready', 'x').ok).toBe(false)
    const archived = foldBoard(rlog(rplanned('r/01'), ['ticket.archived', { id: 'r/01' }])).tickets.get('r/01')!
    expect(agentMove(archived, 'blocked', 'x').ok).toBe(false)
  })
})

// ---- the start guard and the restart (#st-run-start-guard, #werk-board-restart) ----

describe('a run in progress refuses a start on its subtree and below it', () => {
  const ev = (type: BoardEventType, payload: unknown): [BoardEventType, unknown] => [type, payload]
  const x = (id: string, blockedBy: string[] = []): [BoardEventType, unknown] => ['ticket.planned', { id, run: 'x', file: `${id}.md`, title: id, blockedBy }]
  const yes = () => true

  test('a run on an ancestor blocks, and the refusal names it; a run on a descendant does not', () => {
    const b = foldBoard(rlog(ev('project.target', { repo: '/t' }), ev('run.started', { run: 'billing', pid: 11 })))
    expect(startRefusal(b, 'x', ['billing', 'root-ish'], yes)).toEqual({ run: 'billing', why: 'a run is in progress on #billing: see its plan card on the board' })
    expect(startRefusal(b, 'billing', [], yes)?.run).toBe('billing')
    // x is not an ancestor of billing: a run on a descendant is not covered.
    expect(startRefusal(foldBoard(rlog(ev('run.started', { run: 'x', pid: 11 }))), 'billing', [], yes)).toBeUndefined()
  })

  test('a run is in progress only while its process is alive: a Build button group, a plan, or a merge loop', () => {
    const b = foldBoard(rlog(ev('build.started', { run: 'a', pid: 1 }), ev('plan.started', { run: 'b', pid: 2 }), ev('run.started', { run: 'c', pid: 3 })))
    for (const run of ['a', 'b', 'c']) expect(runInProgress(b, run, yes)).toBeDefined()
    expect(runInProgress(b, 'a', () => false)).toBeUndefined()
    // The caller's own process, or its parent, is not a blocking run.
    expect(runInProgress(b, 'c', yes, [3])).toBeUndefined()
  })

  test('the Build button refuses a subtree with unfinished work, and resume needs it', () => {
    const b = foldBoard(rlog(ev('project.target', { repo: '/t' }), x('x/01'), x('x/02'), ev('ticket.moved', { id: 'x/01', to: 'done' })))
    expect(unfinishedWork(b, 'x').map((t) => t.id)).toEqual(['x/02'])
    expect(buildRefusal(b, 'x', [], yes)).toBe('#x has unfinished work: resume it, or restart it')
    expect(resumeRefusal(b, 'x', yes)).toBeUndefined()
    const done = foldBoard(rlog(ev('project.target', { repo: '/t' }), x('x/01'), ev('ticket.moved', { id: 'x/01', to: 'done' })))
    expect(buildRefusal(done, 'x', [], yes)).toBeUndefined()
    expect(resumeRefusal(done, 'x', yes)).toBe('#x has no unfinished work to resume')
  })

  test('a restart lists what it cancels, archives and keeps, and archives with the reason', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-restart-')), 'board.jsonl')
    const seed: Array<[BoardEventType, unknown]> = [
      x('x/01'), x('x/02'), x('x/03'), x('x/04'), x('x/05', ['x/04']),
      ev('ticket.moved', { id: 'x/01', to: 'done' }), ev('ticket.moved', { id: 'x/02', to: 'done' }), ev('ticket.moved', { id: 'x/03', to: 'building' }),
    ]
    for (const [type, payload] of seed) appendBoard(type, payload as never, { path })
    const b = foldBoard(readBoard(path))
    const p = restartPlan(b, 'x')
    expect([p.cancel, p.archive, p.keep].map((ts) => ts.map((t) => t.id))).toEqual([['x/03'], ['x/03', 'x/04', 'x/05'], ['x/01', 'x/02']])
    expect(restartLines('x', p)).toEqual([
      'a restart of #x ends the unfinished work:',
      '  cancel the build of x/03, and keep each branch',
      '  archive x/03, x/04, x/05 (each one can be restored)',
      '  keep x/01, x/02, which are done',
      '  then plan the subtree again from its current spec, and run it',
    ])
    const stopped: string[] = []
    const out = endUnfinishedWork(b, 'x', { path, actor: 'you', stop: (t) => (stopped.push(t.id), false) })
    expect([stopped, out]).toEqual([['x/03'], { cancelled: [], archived: ['x/03', 'x/04', 'x/05'] }])
    const after = foldBoard(readBoard(path))
    expect(unfinishedWork(after, 'x')).toEqual([])
    expect(after.tickets.get('x/04')).toMatchObject({ archived: true, reason: 'a restart of #x ended the unfinished work' })
    expect(after.tickets.get('x/01')!.archived).toBe(false)
  })
})

describe('foldBoard: revisions, cited cards, runs and gates', () => {
  test('a revision rewrites title and blockers, and the column follows the blockers', () => {
    const revise = (blockedBy: string[]) => ['ticket.revised', { id: 'a', title: 'A2', blockedBy }] as const
    const toBlocked = foldBoard(log(planned('z'), planned('a'), [...revise(['z'])])).tickets.get('a')!
    expect([toBlocked.title, toBlocked.blockedBy, toBlocked.column, toBlocked.since]).toEqual(['A2', ['z'], 'blocked', 't2'])
    const toReady = foldBoard(log(planned('z'), planned('a', ['z']), [...revise([])])).tickets.get('a')!
    expect([toReady.column, toReady.since]).toEqual(['ready', 't2'])
    // A ready ticket that stays unblocked keeps its column and its since.
    const same = foldBoard(log(planned('a'), [...revise([])])).tickets.get('a')!
    expect([same.column, same.since]).toEqual(['ready', 't0'])
  })

  test('a revision does not lift a ticket a failed set check holds', () => {
    const b = foldBoard(
      log(planned('a'), ['ticket.moved', { id: 'a', to: 'blocked', reason: 'set check failed', check: 'blocked_by' }], ['ticket.revised', { id: 'a', title: 'A', blockedBy: [] }]),
    )
    expect(b.tickets.get('a')!.column).toBe('blocked')
  })

  const print = { title: 'T', status: 'decided' } as never

  test('recording the cited cards lifts a cited-card hold, back to blocked or ready by blockers', () => {
    const hold = ['ticket.moved', { id: 'a', to: 'blocked', reason: 'card changed', check: 'cited-changed' }] as const
    const cites = ['ticket.cites', { id: 'a', cards: { c: print } }] as const
    const ready = foldBoard(log(planned('a'), [...hold], [...cites])).tickets.get('a')!
    expect([ready.column, ready.heldBy, ready.reason, ready.since, ready.cites]).toEqual(['ready', undefined, undefined, 't2', { c: print }])
    const blocked = foldBoard(log(planned('z'), planned('a', ['z']), [...hold], [...cites])).tickets.get('a')!
    // It never left blocked, so it keeps the since of its planning.
    expect([blocked.column, blocked.heldBy, blocked.since]).toEqual(['blocked', undefined, 't1'])
  })

  test('recording the cited cards keeps a hold of another check', () => {
    const b = foldBoard(
      log(planned('a'), ['ticket.moved', { id: 'a', to: 'blocked', reason: 'x', check: 'blocked_by' }], ['ticket.cites', { id: 'a', cards: {} }]),
    )
    expect(b.tickets.get('a')).toMatchObject({ column: 'blocked', heldBy: 'blocked_by', cites: {} })
  })

  test('proposals and a changed decision are recorded on the ticket', () => {
    const b = foldBoard(
      log(planned('a'), ['ticket.proposals', { id: 'a', cards: { p: print } }], ['ticket.decision-changed', { id: 'a', reason: 'p reopened', followUp: 'r/09' }]),
    )
    expect(b.tickets.get('a')).toMatchObject({ proposals: { p: print }, decisionChanged: 'p reopened' })
  })

  test('the events of an unknown ticket change nothing here either', () => {
    const b = foldBoard(
      log(
        ['ticket.revised', { id: 'x', title: 'X', blockedBy: [] }],
        ['ticket.cites', { id: 'x', cards: {} }],
        ['ticket.proposals', { id: 'x', cards: {} }],
        ['ticket.decision-changed', { id: 'x', reason: 'r', followUp: 'f' }],
        ['ticket.merge', { id: 'x', green: true }],
      ),
    )
    expect(b.tickets.size).toBe(0)
  })

  test('a run records its tier, its cited check, and its pid until it ends', () => {
    const started = log(['run.tier', { run: 'r', tier: 'feature' }], ['run.cited', { run: 'r', ok: false, detail: 'c missing' }], ['run.started', { run: 'r', pid: 42 }])
    expect(foldBoard(started).runs.get('r')).toMatchObject({ tier: 'feature', pid: 42, cited: { ok: false, detail: 'c missing' } })
    const ended = log(...started.map((e) => [e.type, e.payload] as any), ['run.ended', { run: 'r', end: 'green' }])
    expect(foldBoard(ended).runs.get('r')!.pid).toBeUndefined()
  })

  test('a Build button build holds its plan card until it ends', () => {
    const started = log(['build.started', { run: 'r', pid: 9 }])
    expect(foldBoard(started).plans.get('r')!.buildPid).toBe(9)
    expect(foldBoard(log(['build.started', { run: 'r', pid: 9 }], ['build.ended', { run: 'r' }])).plans.get('r')!.buildPid).toBeUndefined()
  })

  test('a gate keeps the last tree it waits on, with the reason, and the last tree passed', () => {
    const b = foldBoard(
      log(
        ['gate.waiting', { run: 'r', gate: 'G2', tip: 'abc', reason: 'held-out red' }],
        ['gate.passed', { run: 'r', gate: 'G2', tip: 'abc' }],
        ['gate.waiting', { run: 'r', gate: 'G2', tip: 'def', reason: 'again' }],
      ),
    )
    expect(b.runs.get('r')!.gates.G2).toEqual({ waiting: 'def', passed: 'abc', reason: 'again' })
  })
})

describe('holders, restart refusal and the build signal', () => {
  const yes = () => true
  const no = () => false

  test('runHolder and buildHolder name the pid only while it is alive', () => {
    const b = foldBoard(log(['run.started', { run: 'r', pid: 5 }], ['build.started', { run: 'r', pid: 6 }]))
    expect(runHolder(b, 'r', yes)).toBe(5)
    expect(runHolder(b, 'r', no)).toBeUndefined()
    expect(runHolder(b, 'other', yes)).toBeUndefined()
    expect(buildHolder(b, 'r', yes)).toBe(6)
    expect(buildHolder(b, 'r', no)).toBeUndefined()
    expect(buildHolder(b, 'other', yes)).toBeUndefined()
  })

  test('a restart needs a decided scope and a target, and refuses while a run is in progress', () => {
    const empty = foldBoard(log())
    expect(restartRefusal(empty, 'r', undefined, yes)).toBe('no card "r" in the map')
    expect(restartRefusal(empty, 'r', ['c1', 'c2'], yes)).toBe('open or proto cards in the scope: c1, c2')
    expect(restartRefusal(empty, 'r', [], yes)).toBe('no target repository is set')
    const busy = foldBoard(log(['project.target', { repo: '/t' }], ['run.started', { run: 'parent', pid: 3 }]))
    expect(restartRefusal(busy, 'r', [], yes, ['parent'])).toBe('a run is in progress on #parent: see its plan card on the board')
    expect(restartRefusal(busy, 'r', [], no, ['parent'])).toBeUndefined()
  })

  test('the Build button and resume refuse with no card, open cards, no target, or a busy run', () => {
    const empty = foldBoard(log())
    expect(buildRefusal(empty, 'r', undefined, yes)).toBe('no card "r" in the map')
    expect(buildRefusal(empty, 'r', ['c'], yes)).toBe('open or proto cards in the scope: c')
    expect(buildRefusal(empty, 'r', [], yes)).toBe('no target repository is set')
    expect(resumeRefusal(empty, 'r', yes)).toBe('no target repository is set')
    const busy = foldBoard(log(['project.target', { repo: '/t' }], ['run.started', { run: 'r', pid: 3 }]))
    expect(buildRefusal(busy, 'r', [], yes)).toBe('a run is in progress on #r: see its plan card on the board')
    expect(resumeRefusal(busy, 'r', yes)).toBe('a run is in progress on #r: see its plan card on the board')
  })

  test('a restart with nothing to cancel or keep says there is nothing to archive', () => {
    expect(restartLines('r', { cancel: [], archive: [], keep: [] })).toEqual([
      'a restart of #r ends the unfinished work:',
      '  nothing to archive',
      '  then plan the subtree again from its current spec, and run it',
    ])
  })

  const liveTicket = (pid: number | undefined, group = false) =>
    foldBoard(log(planned('a'), ['ticket.moved', { id: 'a', to: 'building' }], ['ticket.build.started', { id: 'a', loopRun: 'L', pid, group }])).tickets.get('a')!

  test('signalBuild sends nothing to a ticket with no live session, no pid, or a dead pid', () => {
    expect(signalBuild(foldBoard(log(planned('a'))).tickets.get('a')!, yes)).toBe(false)
    expect(signalBuild(liveTicket(undefined), yes)).toBe(false)
    expect(signalBuild(liveTicket(12345), no)).toBe(false)
  })

  test('signalBuild ends a live build process and says it signalled', async () => {
    const child = Bun.spawn(['sleep', '30'])
    expect(signalBuild(liveTicket(child.pid), yes)).toBe(true)
    expect(await child.exited).not.toBe(0)
    expect(child.signalCode).toBe('SIGTERM')
  })

  test('signalBuild is false, not a throw, when the signal cannot go out', async () => {
    // The child does not lead a process group, so a signal to its group fails.
    const child = Bun.spawn(['sleep', '30'])
    try {
      expect(signalBuild(liveTicket(child.pid, true), yes)).toBe(false)
    } finally {
      child.kill()
      await child.exited
    }
  })
})
