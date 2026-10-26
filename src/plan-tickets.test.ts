import { describe, expect, test } from 'bun:test'
import { fold } from './fold.ts'
import { linkedCards, mapIndex, planBlockers, planScope, renderCard, subtreeCards } from './plan-tickets.ts'
import type { Event } from './types.ts'

type E = [Event['type'], Record<string, unknown>]
const log = (...events: E[]): Event[] => events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }))
const node = (id: string, extra: Record<string, unknown> = {}): E => ['node.added', { id, kind: 'card', title: `T ${id}`, ...extra }]
const edge = (from: string, to: string, type: string): E => ['edge.added', { from, to, type }]

const g = fold(
  log(
    node('root'),
    node('a', { status: 'decided', why: 'w', body: 'the body' }),
    node('b'),
    node('c'),
    node('out'),
    node('a:opt0', { kind: 'option', title: 'other', why_not: 'slow' }),
    node('a:opt1', { kind: 'option', title: 'third' }),
    node('src', { kind: 'source', title: 'paper', url: 'http://x', finding: 'it works' }),
    node('src2', { kind: 'source', title: 'note' }),
    ['node.proposed', { id: 'ghost', kind: 'card', title: 'G' }],
    edge('a', 'root', 'refines'),
    edge('b', 'a', 'refines'),
    edge('c', 'root', 'refines'),
    edge('c', 'b', 'refines'),
    edge('a:opt0', 'a', 'alternative_to'),
    edge('a:opt1', 'a', 'alternative_to'),
    edge('a', 'src', 'supported_by'),
    edge('a', 'src2', 'supported_by'),
    edge('b', 'a', 'depends_on'),
    edge('b', 'out', 'depends_on'),
    edge('src', 'root', 'refines'),
  ),
)

describe('what the planner is shown', () => {
  test('subtreeCards walks refines breadth-first, cards only, each once', () => {
    expect(subtreeCards(g, 'root').map((n) => n.id)).toEqual(['root', 'a', 'c', 'b'])
  })

  test('renderCard gives the card word for word, with its rejected options and sources', () => {
    expect(renderCard(g, g.nodes.get('a')!)).toBe(
      [
        '### a — T a',
        'status: decided',
        'why: w',
        '',
        'the body',
        '',
        'Rejected options:',
        '- other — slow',
        '- third',
        '',
        'Sources:',
        '- paper (http://x): it works',
        '- note',
      ].join('\n'),
    )
    expect(renderCard(g, g.nodes.get('b')!)).toBe('### b — T b\nstatus: decided')
  })

  test('linkedCards takes depends_on targets and #refs one hop out, cards only, none from inside', () => {
    const lg = fold(
      log(
        node('top', { body: 'Uses #ref, #ref again, #top, #a:opt0, #ghost, #nope, and a colour #fff.' }),
        node('kid', { why: 'see #ref2' }),
        node('dep'),
        node('ref'),
        node('ref2'),
        node('far'),
        node('a:opt0', { kind: 'option', title: 'other' }),
        ['node.proposed', { id: 'ghost', kind: 'card', title: 'G' }],
        edge('kid', 'top', 'refines'),
        edge('kid', 'dep', 'depends_on'),
        edge('dep', 'far', 'depends_on'),
        edge('kid', 'top', 'depends_on'),
      ),
    )
    expect(linkedCards(lg, subtreeCards(lg, 'top')).map((n) => n.id)).toEqual(['ref', 'dep', 'ref2'])
  })

  // The worked example on #st-spec-linked.
  const mg = fold(
    log(
      node('infra'),
      node('cdn'),
      node('mail'),
      node('mail-retry'),
      node('mail-bounce', { status: 'open' }),
      node('bounce-kid'),
      node('queue'),
      node('app'),
      node('app-login'),
      edge('cdn', 'infra', 'refines'),
      edge('mail', 'infra', 'refines'),
      edge('mail-retry', 'mail', 'refines'),
      edge('mail-bounce', 'mail', 'refines'),
      edge('bounce-kid', 'mail-bounce', 'refines'),
      edge('app-login', 'app', 'refines'),
      edge('app-login', 'mail', 'depends_on'),
      edge('mail-retry', 'queue', 'depends_on'),
    ),
  )

  test('planScope: the subtree and its links are the first tier; the rest of the walk is context', () => {
    const s = planScope(mg, 'app')
    expect(s.cards.map((n) => n.id)).toEqual(['app', 'app-login', 'mail'])
    expect(s.context.map((n) => n.id)).toEqual(['mail-retry', 'queue'])
  })

  test('scopeClosure never goes up to a parent, and stops at an undecided card without going below it', () => {
    const ids = planScope(mg, 'app').context.map((n) => n.id)
    expect(ids).not.toContain('infra')
    expect(ids).not.toContain('cdn')
    expect(ids).not.toContain('mail-bounce')
    expect(ids).not.toContain('bounce-kid')
  })

  test('an undecided card in the second tier does not block the run', () => {
    expect(planBlockers(mg, 'app')).toEqual([])
  })

  test('scopeClosure leaves out a postponed card and everything that rests on it', () => {
    const pg = fold(
      log(
        node('top'),
        node('dep'),
        node('extra'),
        node('extra-kid'),
        edge('top', 'dep', 'depends_on'),
        edge('dep', 'extra', 'depends_on'),
        edge('extra-kid', 'extra', 'refines'),
        ['reopened', { id: 'extra', reason: 'postponed', why: 'later' }],
      ),
    )
    expect(planScope(pg, 'top').context.map((n) => n.id)).toEqual([])
  })

  test('mapIndex lists every real card, never a ghost or an option', () => {
    expect(mapIndex(g).split('\n')).toEqual(['root: T root', 'a: T a', 'b: T b', 'c: T c', 'out: T out'])
  })

})
