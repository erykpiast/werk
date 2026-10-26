import { describe, expect, test } from 'bun:test'
import {
  activeSeconds, addTokens, allocate, cardOf, classify, decidedDays, distribution, dollars, foldPlanCost, IDLE_SEC, nextPart, openCard, partKey, planTurn, planTurns,
  tokensOf, turnTotals, ZERO_TOKENS, type Response, type Turn,
} from './cost.ts'

const M = 1_000_000

describe('dollars', () => {
  test('each token kind at its own rate', () => {
    expect(dollars('claude-opus-5-5', { input_tokens: M })).toBeCloseTo(4)
    expect(dollars('claude-opus-5-5', { output_tokens: M })).toBeCloseTo(20)
    expect(dollars('claude-opus-5-5', { cache_read_input_tokens: M })).toBeCloseTo(0.2)
  })

  test('a cache write is priced by its lifetime', () => {
    const fiveMin = { cache_creation_input_tokens: M }
    const oneHour = { cache_creation_input_tokens: M, cache_creation: { ephemeral_1h_input_tokens: M } }
    expect(dollars('claude-sonnet-5-5', fiveMin)).toBeCloseTo(2 * 1.25)
    expect(dollars('claude-sonnet-5-5', oneHour)).toBeCloseTo(2 * 2)
  })

  test('a 1-hour split larger than the write total is capped at the total', () => {
    const u = { cache_creation_input_tokens: M, cache_creation: { ephemeral_1h_input_tokens: 3 * M } }
    expect(dollars('claude-sonnet-5-5', u)).toBeCloseTo(4)
  })

  test('fast mode costs twice as much', () => {
    expect(dollars('claude-opus-5-5', { input_tokens: M, speed: 'fast' })).toBeCloseTo(8)
  })

  test('a dated model id prices as its base id', () => {
    expect(dollars('claude-haiku-4-5-20251001', { output_tokens: M })).toBeCloseTo(5)
  })

  test('a model with no price gives null, not zero', () => {
    expect(dollars('claude-unknown', { input_tokens: M })).toBeNull()
  })
})

describe('tokens', () => {
  test('tokensOf reads every kind and defaults a missing one to zero', () => {
    expect(tokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }))
      .toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
    expect(tokensOf({})).toEqual(ZERO_TOKENS)
  })

  test('addTokens scales the second operand', () => {
    expect(addTokens({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, { input: 2, output: 4, cacheRead: 6, cacheWrite: 8 }, 0.5))
      .toEqual({ input: 2, output: 3, cacheRead: 4, cacheWrite: 5 })
  })
})

const bash = (command: string) => ({ type: 'tool_use', name: 'Bash', input: { command } })
const edit = (file_path: string) => ({ type: 'tool_use', name: 'Edit', input: { file_path } })

describe('classify', () => {
  test('a CLI write names its card; a chained command names every card', () => {
    expect(classify([bash('node src/cli.ts add ms-x --title "t"; node src/cli.ts status ms-y decided')]))
      .toEqual({ cards: ['ms-x', 'ms-y'], code: false })
  })

  test('the werk command, a #, a quote and an option suffix all resolve to the card', () => {
    expect(classify([bash(`werk say '#ms-x' "hi"`), bash('bun src/cli.ts link ms-z:opt0 ms-z --type alternative_to')]).cards)
      .toEqual(['ms-x', 'ms-z'])
  })

  test('a read is not a write', () => {
    expect(classify([bash('node src/cli.ts show ms-x; node src/cli.ts stale')])).toEqual({ cards: [], code: false })
  })

  test('an edit to source is code; an edit under the map directory or a temp directory is not', () => {
    expect(classify([edit('/repo/src/a.ts')]).code).toBe(true)
    expect(classify([edit('/repo/.werk/prototypes/x.html')]).code).toBe(false)
    expect(classify([edit('/tmp/x.ts')]).code).toBe(false)
    expect(classify([{ type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/repo/n.ipynb' } }]).code).toBe(true)
  })

  test('text and tool calls without input are ignored', () => {
    expect(classify([{ type: 'text' }, { type: 'tool_use', name: 'Bash' }, { type: 'tool_use', name: 'Read' }]))
      .toEqual({ cards: [], code: false })
  })
})

test('cardOf drops an option suffix', () => {
  expect(cardOf('ms-cost:opt1')).toBe('ms-cost')
  expect(cardOf('ms-cost')).toBe('ms-cost')
})

test('openCard reads both forms of the open-card line', () => {
  expect(openCard('[the map is now at #ms-cost — "Each stage"]\nhi')).toBe('ms-cost')
  expect(openCard('[still on #lp-x:opt0 — "t"]')).toBe('lp-x:opt0')
  expect(openCard('plain prompt')).toBeNull()
})

const resp = (o: Partial<Response> = {}): Response => ({
  model: 'claude-opus-5-5', tokens: { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 }, dollars: 1,
  unpriced: false, cards: [], code: false, ...o,
})
const turn = (o: Partial<Turn> = {}): Turn => ({
  session: 's', turnId: 'u1', at: '2026-10-01T00:00:00Z', endAt: '2026-10-01T00:01:00Z', wallSec: 60,
  openCard: null, responses: [], subagent: [], ...o,
})
/** The rule runs on the turn's stored facts, so every case goes through planTurn first. */
const alloc = (t: Turn, home: string | null) => allocate(planTurn(t, home))

describe('allocate', () => {
  test('a chat-pane turn goes whole to its open card, an option to its card', () => {
    expect(alloc(turn({ openCard: 'a:opt0', responses: [resp()] }), 'home'))
      .toEqual({ plan: 1, prototype: 0, cards: { a: 1 }, reason: 'chat-pane' })
  })

  test('a chat-pane turn that only changed code is all prototype', () => {
    expect(alloc(turn({ openCard: 'a', responses: [resp({ code: true }), resp()] }), null))
      .toEqual({ plan: 1, prototype: 1, cards: { a: 1 }, reason: 'chat-pane' })
  })

  test('a chat-pane turn that wrote to the map and changed code is prototype in that ratio', () => {
    const a = alloc(turn({ openCard: 'a', responses: [resp({ cards: ['b'] }), resp({ code: true }), resp({ code: true }), resp()] }), null)
    expect(a.prototype).toBeCloseTo(2 / 3)
    expect(a.cards).toEqual({ a: 1 })
  })

  test('a chat-pane turn with no open-card line goes to the home card', () => {
    expect(alloc(turn(), 'home')).toEqual({ plan: 1, prototype: 0, cards: { home: 1 }, reason: 'chat-pane' })
  })

  test('a terminal turn that wrote to the map splits equally over the cards it wrote', () => {
    expect(alloc(turn({ responses: [resp({ cards: ['a', 'b'] }), resp({ cards: ['a'] }), resp()] }), null))
      .toEqual({ plan: 1, prototype: 0, cards: { a: 0.5, b: 0.5 }, reason: 'map-write' })
  })

  test('a mixed terminal turn is all plan, its code responses prototype', () => {
    const a = alloc(turn({ responses: [resp({ cards: ['a'] }), resp({ code: true }), resp({ code: true }), resp()] }), null)
    expect(a.reason).toBe('mixed')
    expect(a.plan).toBe(1)
    expect(a.prototype).toBeCloseTo(2 / 3)
    expect(a.cards).toEqual({ a: 1 })
  })

  test('a terminal turn with no map write is not plan cost', () => {
    expect(alloc(turn({ responses: [resp({ code: true })] }), null)).toEqual({ plan: 0, prototype: 0, cards: {}, reason: 'code-only' })
    expect(alloc(turn({ responses: [resp()] }), null)).toEqual({ plan: 0, prototype: 0, cards: {}, reason: 'no-map-write' })
  })
})

test('turnTotals adds subagent responses and counts unpriced ones', () => {
  const t = turnTotals(turn({ responses: [resp()], subagent: [resp({ dollars: 0, unpriced: true })] }))
  expect(t.dollars).toBe(1)
  expect(t.tokens.output).toBe(20)
  expect(t.unpriced).toBe(1)
})

describe('activeSeconds', () => {
  test('counts from the prompt to the last response', () => {
    expect(activeSeconds('2026-10-01T00:00:00Z', ['2026-10-01T00:01:00Z', '2026-10-01T00:03:00Z'])).toBe(180)
  })

  test('leaves out a gap longer than the idle limit', () => {
    const late = new Date(Date.parse('2026-10-01T00:01:00Z') + (IDLE_SEC + 1) * 1000).toISOString()
    expect(activeSeconds('2026-10-01T00:00:00Z', ['2026-10-01T00:01:00Z', late])).toBe(60)
  })

  test('a turn with no response has no wall time', () => {
    expect(activeSeconds('2026-10-01T00:00:00Z', [])).toBe(0)
  })
})

describe('distribution', () => {
  test('median, 90th percentile and maximum, by nearest rank', () => {
    expect(distribution([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({ n: 10, median: 5, p90: 9, max: 10 })
  })

  test('one value is every statistic', () => {
    expect(distribution([3])).toEqual({ n: 1, median: 3, p90: 3, max: 3 })
  })

  test('no values gives zeros', () => {
    expect(distribution([])).toEqual({ n: 0, median: 0, p90: 0, max: 0 })
  })
})

describe('planTurn', () => {
  test('stores the facts the rule needs, with subagents in the cost but not in the counts', () => {
    const t = planTurn(
      turn({ responses: [resp({ cards: ['a', 'b:opt0'] }), resp({ cards: ['a'], code: true }), resp({ code: true }), resp()], subagent: [resp({ unpriced: true })] }),
      null,
      '2026-09-25',
    )
    expect(t).toMatchObject({
      stage: 'plan', step: 'turn', session: 's', turnId: 'u1', card: null, mapResponses: 2, codeResponses: 1,
      responses: 4, ms: 60_000, costUsd: 5, unpriced: 1, prices: '2026-09-25', result: 'ok',
    })
    expect(t.cardsWritten.sort()).toEqual(['a', 'b:opt0'])
    expect(allocate(t).cards).toEqual({ a: 0.5, b: 0.5 })
  })
})

const ev = (seq: number, at: string, payload: object) =>
  ({ seq, at, actor: 'agent', type: 'step.ended', payload }) as any

describe('planTurns', () => {
  test('keeps plan turns only, and a turn written twice once', () => {
    const p = planTurn(turn(), 'a')
    const events = [ev(1, 'x', p), ev(2, 'y', { ...p }), ev(3, 'z', { build: 'B', ticket: 't', step: 'pass', ms: 1, result: 'green' }), { ...ev(4, 'w', p), type: 'step.started' }]
    expect(planTurns(events).map(e => e.at)).toEqual(['x'])
  })

  test('keeps each part of a turn; part 0 and an event with no part are the same part', () => {
    const p = planTurn(turn(), 'a')
    expect(planTurns([ev(1, 'x', p), ev(2, 'y', { ...p, part: 0 }), ev(3, 'z', { ...p, part: 1 })]).map(e => e.at)).toEqual(['x', 'z'])
  })
})

describe('nextPart (#ms-store-plan)', () => {
  const at = (min: number) => `2026-10-01T00:${String(min).padStart(2, '0')}:00Z`
  const t = turn({ at: at(0), responses: [resp({ at: at(1) }), resp({ at: at(3) })], subagent: [resp({ at: at(4) }), resp({ at: at(2) })] })

  test('with nothing recorded, the whole turn is part 0, its wall time from the prompt', () => {
    expect(nextPart(t, [])).toMatchObject({ part: 0, responses: t.responses, wallSec: 240 })
  })

  test('after a part, only the responses since it, in time order, from the last recorded response', () => {
    const first = planTurn({ ...t, responses: t.responses.slice(0, 1), subagent: [t.subagent[1]] }, null)
    const next = nextPart(t, [first])!
    expect(next.part).toBe(1)
    expect(next.responses.map(r => r.at)).toEqual([at(3)])
    expect(next.subagent.map(r => r.at)).toEqual([at(4)])
    expect(next.wallSec).toBe(180)
    expect(nextPart(t, [first, { ...planTurn(next, null), part: 1 }])).toBeNull()
  })

  test('an event with no subagent count takes every subagent as recorded', () => {
    const { subagentResponses: _, ...old } = planTurn({ ...t, responses: t.responses.slice(0, 1) }, null)
    const next = nextPart(t, [old])!
    expect(next.subagent).toEqual([])
    expect(next.responses).toHaveLength(1)
    expect(nextPart({ ...t, responses: t.responses.slice(0, 1) }, [old])).toBeNull()
  })

  test('a response with no time adds no wall time, and a part with no earlier response starts at the prompt', () => {
    const bare = turn({ at: at(0), responses: [resp(), resp()] })
    const first = { ...planTurn(bare, null), responses: 0 }
    expect(nextPart(bare, [first])).toMatchObject({ part: 1, wallSec: 0 })
    expect(partKey({ session: 's', turnId: 'u' })).toBe(partKey({ session: 's', turnId: 'u', part: 0 }))
  })
})

describe('foldPlanCost', () => {
  const chatTurn = planTurn(turn({ turnId: 'c1', session: 'chat', openCard: 'a', responses: [resp({ dollars: 4 })] }), null)
  const termTurn = planTurn(turn({ turnId: 't1', session: 'term', responses: [resp({ cards: ['b'], dollars: 1 }), resp({ code: true, dollars: 1 })] }), null)
  const codeTurn = planTurn(turn({ turnId: 't2', session: 'term', responses: [resp({ code: true, dollars: 3 })] }), null)
  const pipeline = [ev(1, '2026-10-01T10:00:00Z', chatTurn), ev(2, '2026-10-01T11:00:00Z', termTurn), ev(3, '2026-10-02T09:00:00Z', codeTurn)]
  const decisions = [
    { seq: 1, at: '2026-10-01T12:00:00Z', actor: 'agent', type: 'status.set', payload: { id: 'a', status: 'decided' } },
    { seq: 2, at: '2026-10-05T12:00:00Z', actor: 'agent', type: 'status.set', payload: { id: 'z', status: 'decided' } },
  ] as any
  const h = foldPlanCost(pipeline, decisions)

  test('plan and not-plan add up to the total, split by the rule', () => {
    expect(h.dollars).toEqual({ plan: 6, prototype: 1, planChatPane: 4, planTerminal: 2, notPlan: 3 })
    expect(h.reasons).toEqual({
      'chat-pane': { turns: 1, dollars: 4 }, mixed: { turns: 1, dollars: 2 }, 'code-only': { turns: 1, dollars: 3 },
    })
  })

  test('cost and wall time go to cards in the share the rule gives', () => {
    expect(h.cards.map(c => [c.card, c.dollars, c.prototype, c.wallSec, c.turns])).toEqual([['a', 4, 0, 60, 1], ['b', 2, 1, 60, 1]])
    expect(h.perCard).toEqual({ n: 2, median: 2, p90: 4, max: 4 })
  })

  test('a turn counts in the day it ended; a decided day with no plan turn adds no day', () => {
    expect(h.days).toEqual([
      { day: '2026-10-01', plan: 6, prototype: 1, notPlan: 0, decided: 1, perDecided: 6 },
      { day: '2026-10-02', plan: 0, prototype: 0, notPlan: 3, decided: 0, perDecided: null },
    ])
    expect(h.perDecidedCardPerDay.n).toBe(1)
  })

  test('sessions are chat pane when a turn names a card', () => {
    expect(h.sessions).toEqual({ chatPane: 1, terminal: 1 })
    expect(h.prices).toEqual([chatTurn.prices])
  })
})

test('decidedDays keeps the first day a card became decided, and only cards', () => {
  const days = decidedDays([
    { seq: 1, at: '2026-10-01T00:00:00Z', type: 'status.set', payload: { id: 'a', status: 'decided' } },
    { seq: 2, at: '2026-10-02T00:00:00Z', type: 'status.set', payload: { id: 'a', status: 'decided' } },
    { seq: 3, at: '2026-10-02T00:00:00Z', type: 'status.set', payload: { id: 'c', status: 'open' } },
    { seq: 4, at: '2026-10-03T00:00:00Z', type: 'node.proposed', payload: { id: 'd', kind: 'card', status: 'decided' } },
    { seq: 5, at: '2026-10-03T00:00:00Z', type: 'node.added', payload: { id: 'd:opt0', kind: 'option', status: 'decided' } },
  ] as any)
  expect([...days]).toEqual([['a', '2026-10-01'], ['d', '2026-10-03']])
})
