import { describe, expect, test } from 'bun:test'
import { foldBoard } from './board.ts'
import type { BoardEvent } from './board.ts'
import { dependentsOf, lastHeldout, lastMerged, mergedSteps, mergeFailure, nextToBuild, nextToMerge, openFollowUp, passesLeft, resumeOf } from './run-state.ts'

const ev = (type: string, payload: Record<string, unknown>, seq: number): BoardEvent =>
  ({ seq, at: '2026-10-01T10:00:00.000Z', actor: 'agent', type, payload }) as BoardEvent

const planned = (id: string, seq: number) => ev('ticket.planned', { id, run: id.split('/')[0], file: `.werk/tickets/${id}.md`, title: id, blockedBy: [] }, seq)

describe('mergeFailure', () => {
  test('a ticket with no merge, or a green one, has no failure to carry', () => {
    const b = foldBoard([planned('r1/01', 1), planned('r1/02', 2), ev('ticket.merge', { id: 'r1/02', green: true, commit: 'c' }, 3)])
    expect(mergeFailure(b.tickets.get('r1/01')!)).toBeUndefined()
    expect(mergeFailure(b.tickets.get('r1/02')!)).toBeUndefined()
  })

  test('a red merge becomes a merge failure, with stand-ins for what the board left out', () => {
    const b = foldBoard([
      planned('r1/01', 1),
      planned('r1/02', 2),
      ev('ticket.merge', { id: 'r1/01', green: false, cmd: 'make merged', code: 2, detail: 'red on the run tree' }, 3),
      ev('ticket.merge', { id: 'r1/02', green: false }, 4),
    ])
    expect(mergeFailure(b.tickets.get('r1/01')!)).toEqual({ kind: 'merge', cmd: 'make merged', code: 2, tail: 'red on the run tree' })
    expect(mergeFailure(b.tickets.get('r1/02')!)).toEqual({ kind: 'merge', cmd: '?', code: -1, tail: '' })
  })
})

describe('lastHeldout', () => {
  test("the last held-out result among the run's own tickets, in board order", () => {
    const events = [
      planned('r1/01', 1),
      planned('r1/02', 2),
      planned('r2/01', 3),
      ev('ticket.heldout', { id: 'r1/01', green: false, failed: ['01.1 x'] }, 4),
      ev('ticket.heldout', { id: 'r1/02', green: true }, 5),
      ev('ticket.heldout', { id: 'r2/01', green: false }, 6),
    ]
    const b = foldBoard(events)
    const r1 = [b.tickets.get('r1/01')!, b.tickets.get('r1/02')!]
    expect(lastHeldout(events, r1)).toEqual({ id: 'r1/02', green: true })
    expect(lastHeldout(events, [b.tickets.get('r1/01')!])).toEqual({ id: 'r1/01', green: false, failed: ['01.1 x'] })
    expect(lastHeldout(events.slice(0, 3), r1)).toBeUndefined()
  })

  test('after a green merge, only that merge\'s own result counts, even when an older run ends later (#st-heldout-beside)', () => {
    const events = [
      planned('r1/01', 1),
      planned('r1/02', 2),
      ev('ticket.merge', { id: 'r1/01', green: true, commit: 'a' }, 3),
      ev('ticket.merge', { id: 'r1/02', green: true, commit: 'b' }, 4),
      ev('ticket.heldout', { id: 'r1/02', green: false, failed: ['01.1 x'] }, 5),
      ev('ticket.heldout', { id: 'r1/01', green: true }, 6),
    ]
    const r1 = [...foldBoard(events).tickets.values()]
    expect(lastHeldout(events, r1)).toEqual({ id: 'r1/02', green: false, failed: ['01.1 x'] })
    expect(lastMerged(events, r1)).toBe('r1/02')
    // The tip's run has not ended yet: no result on the tip.
    expect(lastHeldout(events.slice(0, 4), r1)).toBeUndefined()
    // A red merge does not move the tip.
    const red = [...events, ev('ticket.merge', { id: 'r1/01', green: false, conflict: true }, 7)]
    expect(lastMerged(red, r1)).toBe('r1/02')
  })
})

describe('nextToMerge (#st-build-conflict-resolve)', () => {
  test('a ticket back from a conflict merges first; otherwise the board order holds', () => {
    const b = foldBoard([planned('r1/01', 1), planned('r1/02', 2), ev('ticket.merge', { id: 'r1/02', green: false, conflict: true }, 3)])
    const [one, two] = [b.tickets.get('r1/01')!, b.tickets.get('r1/02')!]
    expect(nextToMerge([one, two])).toBe(two)
    expect(nextToMerge([one])).toBe(one)
    expect(nextToMerge([])).toBeUndefined()
  })
})

describe('dependentsOf (#st-build-stuck-park)', () => {
  test('every ticket that needs the stuck one, directly or through others, once each', () => {
    const t = (id: string, blockedBy: string[]) => ({ id, blockedBy }) as Parameters<typeof dependentsOf>[0][number]
    const all = [t('a', []), t('b', ['a']), t('c', ['b']), t('d', ['a', 'c']), t('e', [])]
    expect(dependentsOf(all, 'a').sort()).toEqual(['b', 'c', 'd'])
    expect(dependentsOf(all, 'e')).toEqual([])
  })
})

describe('mergedSteps (#st-heldout-merged-only)', () => {
  test('keeps the steps of done tickets only, and drops those of archived or unmerged ones', () => {
    const b = foldBoard([
      planned('r1/01', 1),
      planned('r1/02', 2),
      planned('r1/03', 3),
      planned('r1/04', 4),
      ev('ticket.moved', { id: 'r1/01', to: 'done' }, 5),
      ev('ticket.moved', { id: 'r1/02', to: 'building' }, 6),
      ev('ticket.moved', { id: 'r1/03', to: 'done' }, 7),
      ev('ticket.archived', { id: 'r1/03' }, 8),
    ])
    const step = (ticket: string, n: number) => ({ id: `${ticket.split('/')[1]}.${n}`, ticket, text: 'Given x' })
    const steps = ['r1/01', 'r1/02', 'r1/03', 'r1/04'].flatMap((t) => [step(t, 1), step(t, 2)])
    expect(mergedSteps(steps, [...b.tickets.values()]).map((s) => s.id)).toEqual(['01.1', '01.2'])
    expect(mergedSteps(steps, [])).toEqual([])
  })
})

const fold = (...rest: Array<[string, Record<string, unknown>]>) => foldBoard([planned('r1/01', 1), ...rest.map(([type, payload], i) => ev(type, { id: 'r1/01', ...payload }, i + 2))]).tickets.get('r1/01')!

describe('resumeOf', () => {
  test('a ticket that never built starts fresh, with no failure', () => {
    expect(resumeOf(fold())).toEqual({})
  })

  test('a red check on the merged tree goes on from the branch the merge took (#st-build-run-mechanics)', () => {
    const t = fold(['ticket.build.started', { loopRun: 'a' }], ['ticket.build.ended', { loopRun: 'a', result: 'green' }], ['ticket.merge', { green: false, branch: 'werk-build/a', cmd: 'make test', code: 2, detail: 'red' }])
    expect(resumeOf(t)).toEqual({ startFrom: 'werk-build/a', lastFailure: { kind: 'merge', cmd: 'make test', code: 2, tail: 'red' } })
  })

  test('a conflict resolves on the branch the merge took, with the conflict output as the failure (#st-build-conflict-resolve)', () => {
    const t = fold(['ticket.build.started', { loopRun: 'a' }], ['ticket.build.ended', { loopRun: 'a', result: 'green' }], ['ticket.merge', { green: false, branch: 'werk-build/a', cmd: 'git merge werk-build/a', code: 1, detail: 'CONFLICT (content)', conflict: true }])
    expect(resumeOf(t)).toEqual({ resolveFrom: 'werk-build/a', lastFailure: { kind: 'merge', cmd: 'git merge werk-build/a', code: 1, tail: 'CONFLICT (content)', conflict: true } })
  })

  test('a green build the loop stopped before its merge goes on from its own branch (#st-build-stop-ready)', () => {
    // An older red merge does not name the newer green build's branch.
    const t = fold(
      ['ticket.merge', { green: false, branch: 'werk-build/a', cmd: 'make test', code: 2 }],
      ['ticket.build.started', { loopRun: 'b' }],
      ['ticket.build.ended', { loopRun: 'b', result: 'green' }],
      ['ticket.moved', { to: 'merging' }],
      ['ticket.moved', { to: 'ready', reason: 'the merge loop stopped: checkout', loopStop: 'checkout' }],
    )
    expect(resumeOf(t)).toEqual({ startFrom: 'werk-build/b' })
  })

  test('a build whose process died goes on from its own branch, with the death as its failure (#st-build-died)', () => {
    const t = fold(
      ['ticket.merge', { green: false, branch: 'werk-build/a', cmd: 'make test', code: 2 }],
      ['ticket.build.started', { loopRun: 'b' }],
      ['ticket.build.ended', { loopRun: 'b', result: 'died' }],
    )
    expect(resumeOf(t)).toEqual({ startFrom: 'werk-build/b', lastFailure: { kind: 'died', detail: 'the build process died mid-pass' } })
  })
})

describe('passesLeft (#st-build-run-cap, #st-build-conflict)', () => {
  test('every pass counts against the cap, and every conflict gives one back', () => {
    const pass = (n: number): [string, Record<string, unknown>] => ['ticket.pass', { loopRun: 'a', pass: n, green: true }]
    expect(passesLeft(fold(pass(1), pass(2)), 5)).toBe(3)
    const conflict: [string, Record<string, unknown>] = ['ticket.merge', { green: false, conflict: true }]
    expect(passesLeft(fold(pass(1), conflict, pass(1), conflict), 2)).toBe(2)
    // A red check is the ticket's own failure: no pass back.
    expect(passesLeft(fold(pass(1), ['ticket.merge', { green: false, cmd: 'make test', code: 2 }]), 2)).toBe(1)
  })

  test('a pass that died counts against the cap, though it wrote no pass of its own (#st-build-died)', () => {
    const died: [string, Record<string, unknown>] = ['ticket.build.ended', { loopRun: 'a', result: 'died' }]
    expect(passesLeft(fold(['ticket.pass', { loopRun: 'a', pass: 1, green: false }], died), 5)).toBe(3)
  })
})

describe('a retry after a stuck stop (#st-build-stuck-retry)', () => {
  const pass = (n: number): [string, Record<string, unknown>] => ['ticket.pass', { loopRun: 'a', pass: n, green: false }]
  const stuck: [string, Record<string, unknown>] = ['ticket.moved', { to: 'blocked', reason: 'stuck: cap', check: 'stuck' }]

  test('moving a stuck ticket to ready starts a new budget', () => {
    const t = fold(pass(1), pass(2), pass(3), stuck, ['ticket.moved', { to: 'ready' }], pass(1))
    expect(passesLeft(t, 3)).toBe(2)
  })

  test('a block by an open ticket or any other hold keeps the passes already spent', () => {
    const held: [string, Record<string, unknown>] = ['ticket.moved', { to: 'blocked', reason: 'a check failed', check: 'ticket-check' }]
    expect(passesLeft(fold(pass(1), pass(2), held, ['ticket.moved', { to: 'ready' }]), 3)).toBe(1)
  })
})

describe('nextToBuild (#st-build-parallel)', () => {
  const board = (extra: BoardEvent[] = []) =>
    [...foldBoard([planned('r1/01', 1), planned('r1/02', 2), planned('r1/03', 3), ...extra]).tickets.values()]
  const modules: Record<string, string[]> = { 'r1/01': ['merge queue'], 'r1/02': ['Merge Queue '], 'r1/03': ['board'] }
  const touches = (t: { id: string }) => modules[t.id] ?? []
  const none = () => false

  test('with nothing in flight, the first ready ticket in board order starts', () => {
    expect(nextToBuild(board(), none, touches)?.id).toBe('r1/01')
  })

  test('a ticket that shares a module with a build in flight waits, and a later one starts', () => {
    expect(nextToBuild(board(), (id) => id === 'r1/01', touches)?.id).toBe('r1/03')
    expect(nextToBuild(board(), (id) => id === 'r1/01' || id === 'r1/03', touches)).toBeUndefined()
  })

  test('a ticket in merging holds its modules too', () => {
    const tickets = board([ev('ticket.moved', { id: 'r1/01', to: 'merging' }, 9)])
    expect(nextToBuild(tickets, none, touches)?.id).toBe('r1/03')
  })

  test('a ticket that names no module builds alone, and nothing starts beside it', () => {
    const blank = (t: { id: string }) => (t.id === 'r1/01' ? [] : touches(t))
    expect(nextToBuild(board(), (id) => id === 'r1/03', blank)?.id).toBe('r1/02')
    expect(nextToBuild(board(), (id) => id === 'r1/01', blank)).toBeUndefined()
  })

  test('building first, then the tickets a stopped loop returned, then the rest of ready (#st-build-stop-ready)', () => {
    const returned = ev('ticket.moved', { id: 'r1/03', to: 'ready', reason: 'the merge loop stopped: stuck', loopStop: 'stuck' }, 9)
    expect(nextToBuild(board([returned]), none, touches)?.id).toBe('r1/03')
    const triggered = ev('ticket.moved', { id: 'r1/02', to: 'building' }, 10)
    expect(nextToBuild(board([returned, triggered]), none, touches)?.id).toBe('r1/02')
  })
})

describe('openFollowUp (#st-followup-one-open)', () => {
  const followUp = (id: string, of: string, extra: Record<string, unknown>, seq: number) => ev('ticket.planned', { id, run: 'r1', file: `.werk/tickets/${id}.md`, title: id, blockedBy: [], followUpOf: of, ...extra }, seq)
  const tickets = (events: BoardEvent[]) => [...foldBoard(events).tickets.values()]

  test('a step follow-up and a rework of the same ticket are told apart', () => {
    const t = tickets([planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2), followUp('r1/03', 'r1/01', { rework: true }, 3)])
    expect(openFollowUp(t, 'r1/01', 'steps')?.ticket.id).toBe('r1/02')
    expect(openFollowUp(t, 'r1/01', 'rework')?.ticket.id).toBe('r1/03')
  })

  test('a ticket in ready has not started, and a ticket in building has', () => {
    const events = [planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2)]
    expect(openFollowUp(tickets(events), 'r1/01', 'steps')?.started).toBe(false)
    const building = [...events, ev('ticket.moved', { id: 'r1/02', to: 'building' }, 3)]
    expect(openFollowUp(tickets(building), 'r1/01', 'steps')?.started).toBe(true)
  })

  test('a done or archived follow-up, or one of another ticket, is not open', () => {
    const done = [planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2), ev('ticket.moved', { id: 'r1/02', to: 'done' }, 3)]
    expect(openFollowUp(tickets(done), 'r1/01', 'steps')).toBeUndefined()
    const archived = [planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2), ev('ticket.archived', { id: 'r1/02' }, 3)]
    expect(openFollowUp(tickets(archived), 'r1/01', 'steps')).toBeUndefined()
    expect(openFollowUp(tickets([planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2)]), 'r1/09', 'steps')).toBeUndefined()
  })

  test('a revision that adds steps changes what the follow-up carries', () => {
    const t = tickets([planned('r1/01', 1), followUp('r1/02', 'r1/01', { steps: ['01.1'] }, 2), ev('ticket.revised', { id: 'r1/02', title: 'x', blockedBy: [], steps: ['01.1', '01.2'] }, 3)])
    expect(openFollowUp(t, 'r1/01', 'steps')?.ticket.steps).toEqual(['01.1', '01.2'])
  })
})
