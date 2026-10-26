import { describe, expect, test } from 'bun:test'
import { measures, stageOf, stopKind } from './measures.ts'
import type { PipelineEvent } from './pipeline.ts'

const session = (seq: number, name: string, costUsd: number): PipelineEvent =>
  ({ seq, at: '2026-10-21T10:00:00.000Z', actor: 'agent', type: 'step.ended', payload: { step: 'session', name, ticket: 'werk/1', build: 'b1', costUsd } }) as unknown as PipelineEvent

describe('stageOf', () => {
  test('drops the pass number and names the builder and the grader', () => {
    expect(stageOf('review-tests-3')).toBe('review-tests')
    expect(stageOf('pass-1')).toBe('build')
    expect(stageOf('grade-2')).toBe('grader')
    expect(stageOf('review-design')).toBe('review-design')
  })
})

describe('measures', () => {
  test('one stage line sums every pass of that stage in the hour', () => {
    const m = measures([session(1, 'review-tests-1', 1), session(2, 'review-tests-2', 2), session(3, 'pass-1', 4)])
    expect(m.stages.map((s) => [s.stage, s.hour, s.costUsd])).toEqual([
      ['build', '2026-10-21T10', 4],
      ['review-tests', '2026-10-21T10', 3],
    ])
  })

  test('a stage hour holds its tokens and its time, so the panel can switch unit', () => {
    const tokens = { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }
    const withTokens = { ...session(1, 'pass-1', 1), payload: { ...session(1, 'pass-1', 1).payload, ms: 60_000, tokens } } as PipelineEvent
    // An older session event has no tokens. Its transcript names them.
    const older = { ...session(2, 'pass-2', 2), payload: { ...session(2, 'pass-2', 2).payload, ms: 30_000, file: 'runs/b1/pass-2.jsonl' } } as PipelineEvent
    const fromFile = (file: string) => (file === 'runs/b1/pass-2.jsonl' ? { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } : undefined)
    const [build] = measures([withTokens, older], undefined, [], fromFile).stages
    expect(build.ms).toBe(90_000)
    expect(build.tokens).toEqual({ input: 11, output: 22, cacheRead: 303, cacheWrite: 44 })
  })

  test('an effort point holds the time its passes ran and the tokens its sessions spent', () => {
    const at = '2026-10-21T10:00:00.000Z'
    const ev = (seq: number, type: string, payload: object) => ({ seq, at, actor: 'agent', type, payload }) as unknown as PipelineEvent
    const pass = (n: number, green: boolean, ms: number) => [
      ev(n * 10, 'step.started', { step: 'pass', build: 'b1', ticket: 'werk/1', pass: n }),
      ev(n * 10 + 1, 'step.ended', { step: 'session', build: 'b1', ticket: 'werk/1', pass: n, name: `pass-${n}`, ms: 1, costUsd: 1, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }),
      ev(n * 10 + 2, 'step.ended', { step: 'pass', build: 'b1', ticket: 'werk/1', pass: n, ms, result: green ? 'green' : 'red', pass_end: { green, checks: [] } }),
    ]
    const [p] = measures([...pass(1, false, 600_000), ...pass(2, true, 300_000)]).effort
    expect(p.ms).toBe(900_000)
    expect(p.tokens).toEqual({ input: 2, output: 2, cacheRead: 2, cacheWrite: 2 })
    expect(p.costUsd).toBe(2)
  })

  test('sends the fails and the false-finding rule for the drill-down', () => {
    const m = measures([])
    expect(m.fails).toEqual([])
    expect(m.falseShare).toBeGreaterThan(0)
    expect(m.falseMinFails).toBeGreaterThan(0)
  })
})

describe('stops', () => {
  const mv = (seq: number, at: string, id: string, to: string, reason?: string) => ({ seq, at, actor: 'agent', type: 'ticket.moved', payload: { id, to, reason } }) as never

  test('a stop ends at the ticket next move', () => {
    const board = [
      mv(1, '2026-10-21T10:00:00.000Z', 'werk/1', 'blocked', 'set check blocked_by failed: x'),
      mv(2, '2026-10-21T10:10:00.000Z', 'werk/1', 'ready', 'the blocked_by set check passes again'),
      mv(3, '2026-10-21T11:00:00.000Z', 'werk/2', 'ready', 'the merge loop stopped: stuck'),
    ]
    const s = measures([], undefined, board).stops
    expect(s.map((x) => [x.kind, x.item, x.end])).toEqual([
      ['check', 'werk/1', '2026-10-21T10:10:00.000Z'],
      ['loop-stopped', 'werk/2', null],
    ])
  })

  test('the structured fields decide the kind, whatever the reason says', () => {
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'anything', check: 'stuck' })).toBe('stuck')
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'anything', check: 'cited-changed' })).toBe('cited-changed')
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'anything', check: 'blocked_by' })).toBe('check')
    expect(stopKind({ id: 'a', to: 'ready', reason: 'reworded', loopStop: 'stuck' })).toBe('loop-stopped')
  })

  test('a move with no structured field falls back to the start of its reason', () => {
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'own check lint failed: x' })).toBe('check')
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'stuck: three red passes' })).toBe('stuck')
    expect(stopKind({ id: 'a', to: 'blocked', reason: 'waits for a person' })).toBe('blocked')
    expect(stopKind({ id: 'a', to: 'ready', reason: 'every ticket it needs is merged: werk/1' })).toBeNull()
  })

  test('a red merge is a stop until the ticket moves on from building', () => {
    const board = [
      { seq: 1, at: '2026-10-21T10:00:00.000Z', actor: 'agent', type: 'ticket.merge', payload: { id: 'werk/3', green: false, cmd: 'make test', code: 2, conflict: true } },
      mv(2, '2026-10-21T10:00:00.001Z', 'werk/3', 'building', 'conflicts with the main line: make test (exit 2)'),
      mv(3, '2026-10-21T10:40:00.000Z', 'werk/3', 'merging'),
    ] as never
    expect(measures([], undefined, board).stops).toEqual([{ kind: 'main-conflict', item: 'werk/3', at: '2026-10-21T10:00:00.000Z', end: '2026-10-21T10:40:00.000Z', reason: 'make test (exit 2)' }])
  })

  test('a gate stop ends when the gate passes', () => {
    const board = [
      { seq: 1, at: '2026-10-21T10:00:00.000Z', actor: 'agent', type: 'gate.waiting', payload: { run: 'r', gate: 'G2', tip: 't', reason: 'review' } },
      { seq: 2, at: '2026-10-21T10:30:00.000Z', actor: 'you', type: 'gate.passed', payload: { run: 'r', gate: 'G2', tip: 't' } },
    ] as never
    expect(measures([], undefined, board).stops[0]).toMatchObject({ kind: 'gate', end: '2026-10-21T10:30:00.000Z' })
  })

  test('a restart is one stop for its subtree, until the subtree plans again (#ms-outcome-interv)', () => {
    const at = '2026-10-21T10:00:00.000Z'
    const archived = (seq: number, id: string, restart?: string) => ({ seq, at, actor: 'you', type: 'ticket.archived', payload: { id, reason: 'a restart of #r ended the unfinished work', restart } })
    const board = [
      archived(1, 'r/01', 'r'),
      archived(2, 'r/02', 'r'),
      archived(3, 'r/03'),
      { seq: 4, at: '2026-10-21T10:05:00.000Z', actor: 'agent', type: 'plan.started', payload: { run: 'r' } },
    ] as never
    expect(measures([], undefined, board).stops).toEqual([{ kind: 'restart', item: 'r', at, end: '2026-10-21T10:05:00.000Z', reason: 'a restart of #r ended the unfinished work' }])
  })
})
