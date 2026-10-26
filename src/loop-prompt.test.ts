import { describe, expect, test } from 'bun:test'
import { fold } from './fold.ts'
import { decidedClosure, FAILURE_CHARS, freshPrompt, tail } from './loop-prompt.ts'
import type { Event } from './types.ts'

const log = (...events: Array<[Event['type'], Record<string, unknown>]>): Event[] =>
  events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }))
const card = (id: string, extra: Record<string, unknown> = {}) =>
  ['node.added', { id, kind: 'card', title: `T ${id}`, status: 'decided', ...extra }] as [Event['type'], Record<string, unknown>]
const dep = (from: string, to: string) => ['edge.added', { from, to, type: 'depends_on' }] as [Event['type'], Record<string, unknown>]

describe('tail', () => {
  test('a short output is kept whole', () => {
    expect(tail('ok')).toBe('ok')
  })
  test('a long one keeps its end, where the summary is, and says how much was cut', () => {
    const out = tail('a'.repeat(10) + 'END', 5)
    expect(out).toBe('[... 8 characters cut ...]\naaEND')
    expect(tail('x'.repeat(FAILURE_CHARS + 1)).startsWith('[... 1 characters cut ...]')).toBe(true)
  })
})

describe('decidedClosure', () => {
  test('walks depends_on past an open card, and keeps only decided, non-stale cards (s is stale)', () => {
    const g = fold(
      log(card('a'), card('b', { status: 'open' }), card('c'), card('d'), card('s'), ['node.added', { id: 'src', kind: 'source', title: 's' }], dep('a', 'b'), dep('b', 'c'), dep('a', 'src'), dep('a', 'd'), dep('d', 'c'), dep('a', 's'), card('x'), dep('s', 'x'), ['reopened', { id: 'x' }], ['rederived', { id: 'a' }]),
    )
    expect(decidedClosure(g, ['a', 'missing']).map((n) => n.id)).toEqual(['a', 'd', 'c'])
  })
})

describe('the prompts', () => {
  const cards = [{ id: 'a', kind: 'card' as const, title: 'A', why: 'because', body: 'the body' }, { id: 'b', kind: 'card' as const, title: 'B' }]
  const checks = ['make test', 'make lint']

  test('the first fresh pass is told it is first, and that nothing failed yet', () => {
    const p = freshPrompt({ brief: 'do it', cards, checks, pass: 1, cap: 3, base: 'abc' })
    expect(p).toContain('You are pass 1 of at most 3')
    expect(p).toContain('You are the first pass.')
    expect(p).toContain('No check has failed yet.')
    expect(p).toContain('### #a — A\nwhy: because\nthe body')
    expect(p).toContain('- `make test`\n- `make lint`')
  })

  test('a later pass is pointed at git for memory, and shown the last failure', () => {
    const p = freshPrompt({
      brief: 'do it',
      cards: [],
      checks,
      pass: 2,
      cap: 3,
      base: 'abc',
      lastFailure: { cmd: 'make test', ok: false, code: 1, ms: 5, tail: '1 fail' },
    })
    expect(p).toContain('git log --oneline abc..HEAD')
    expect(p).toContain('Command: `make test` (exit 1)')
    expect(p).toContain('1 fail')
    expect(p).toContain('(none given)')
  })
})
