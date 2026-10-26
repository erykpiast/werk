import { describe, expect, test } from 'bun:test'
import { cardFlows, chatWaits, probeCounts, rederives } from './flow.ts'
import type { Event, EventType } from './types.ts'

function log(...events: Array<[EventType, Record<string, unknown>]>): Event[] {
  return events.map(([type, payload], i) => ({
    seq: i + 1,
    at: `2026-09-22T10:${String(i).padStart(2, '0')}:00.000Z`,
    actor: 'agent' as const,
    type,
    payload,
  }))
}

describe('cardFlows', () => {
  test('records each status change with the status before it', () => {
    const { cards } = cardFlows(
      log(
        ['node.added', { id: 'a', kind: 'card', status: 'open' }],
        ['status.set', { id: 'a', status: 'proto' }],
        ['status.set', { id: 'a', status: 'decided' }],
        ['reopened', { id: 'a', reason: 'postponed' }],
      ),
    )
    expect(cards[0].steps.map((s) => [s.from, s.to, s.reason])).toEqual([
      [null, 'open', undefined],
      ['open', 'proto', undefined],
      ['proto', 'decided', undefined],
      ['decided', 'open', 'postponed'],
    ])
  })

  test('a ghost enters only when its proposal is accepted', () => {
    const { cards } = cardFlows(
      log(
        ['node.proposed', { id: 'g', kind: 'card', status: 'open' }],
        ['node.proposed', { id: 'd', kind: 'card', status: 'open' }],
        ['change.discarded', { id: 'd' }],
        ['change.accepted', { id: 'g' }],
      ),
    )
    expect(cards.map((c) => c.id)).toEqual(['g'])
    expect(cards[0].steps[0].at).toBe('2026-09-22T10:03:00.000Z')
  })

  test('skips non-card nodes and keeps removed cards marked', () => {
    const r = cardFlows(
      log(
        ['node.added', { id: 's', kind: 'source' }],
        ['node.added', { id: 'a', kind: 'card' }],
        ['node.removed', { id: 'a' }],
      ),
    )
    expect(r.cards.map((c) => c.id)).toEqual(['a'])
    expect(r.removed).toEqual(['a'])
  })
})

describe('rederives', () => {
  const base: Array<[EventType, Record<string, unknown>]> = [
    ['node.added', { id: 'up', kind: 'card', status: 'decided' }],
    ['node.added', { id: 'a', kind: 'card', status: 'decided' }],
    ['edge.added', { from: 'a', to: 'up', type: 'depends_on' }],
  ]

  test('counts a rederive only when it clears a stale mark', () => {
    const r = rederives(
      log(
        ...base,
        ['rederived', { id: 'a', status: 'decided' }],
        ['reopened', { id: 'up', reason: 'invalidated' }],
        ['rederived', { id: 'a', status: 'decided' }],
      ),
    )
    expect(r).toEqual([{ id: 'a', at: '2026-09-22T10:05:00.000Z', changed: false, by: 'agent' }])
  })

  test('a text edit after the reopen counts as changed; one before it does not', () => {
    const r = rederives(
      log(
        ...base,
        ['node.retitled', { id: 'a', title: 'before' }],
        ['reopened', { id: 'up', reason: 'invalidated' }],
        ['change.proposed', { id: 'a', why: 'new why' }],
        ['change.accepted', { id: 'a' }],
        ['rederived', { id: 'a' }],
      ),
    )
    expect(r.map((x) => x.changed)).toEqual([true])
  })

  test('a postponed reopen makes nothing stale, so its rederive is not counted', () => {
    const r = rederives(log(...base, ['reopened', { id: 'up', reason: 'postponed' }], ['rederived', { id: 'a' }]))
    expect(r).toEqual([])
  })

  test('records who made the review', () => {
    const events = log(...base, ['reopened', { id: 'up', reason: 'invalidated' }], ['rederived', { id: 'a' }])
    events[events.length - 1].actor = 'you'
    expect(rederives(events).map((x) => x.by)).toEqual(['you'])
  })
})

describe('probeCounts (#lp-overseer-psfail-metric)', () => {
  test('reads each session count in a pass stream and skips every other line', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'werk_overseer', at: '2026-10-11T10:00:00.000Z', kind: 'probe-failed', error: 'x' }),
      JSON.stringify({ type: 'werk_overseer', at: '2026-10-11T10:01:00.000Z', kind: 'probes', samples: 12, failed: 1 }),
      '{"type":"werk_overseer","kind":"probes", cut off mid-write',
      JSON.stringify({ type: 'werk_overseer', at: '2026-10-11T10:02:00.000Z', kind: 'probes', samples: 0, failed: 0 }),
      JSON.stringify({ type: 'werk_overseer', at: '2026-10-11T10:03:00.000Z', kind: 'probes', samples: 4, failed: 9 }),
      '',
    ].join('\n')
    expect(probeCounts(stream)).toEqual([
      { at: '2026-10-11T10:01:00.000Z', samples: 12, failed: 1 },
      { at: '2026-10-11T10:03:00.000Z', samples: 4, failed: 4 },
    ])
  })
})

describe('chatWaits (#ms-outcome-interv-chat-q)', () => {
  const line = (o: object) => JSON.stringify(o)
  const next = (t: string) => (/Next: say "([^"]+)"/.exec(t.trim().split('\n').pop() ?? '')?.[1] ?? null)

  test('a next-action button waits from its message to the next message from the person', () => {
    const text = [
      line({ at: '2026-10-11T10:00:00.000Z', from: 'you', text: 'hi', card: 'a' }),
      line({ at: '2026-10-11T10:01:00.000Z', from: 'agent', text: 'Done.\n\nNext: say "merge it"' }),
      line({ at: '2026-10-11T10:01:05.000Z', from: 'agent', text: 'Also.\n\nNext: say "merge it"' }),
      line({ at: '2026-10-11T10:05:00.000Z', from: 'you', text: 'merge it', card: 'b' }),
      line({ at: '2026-10-11T10:06:00.000Z', from: 'agent', text: 'Merged. Nothing is open.' }),
      line({ at: '2026-10-11T10:07:00.000Z', from: 'agent', text: 'Next: say "release"' }),
    ].join('\n')
    expect(chatWaits([{ convo: 'main', text }], '', next)).toEqual([
      { convo: 'main', card: 'a', kind: 'button', start: '2026-10-11T10:01:00.000Z', end: '2026-10-11T10:05:00.000Z' },
      { convo: 'main', card: 'b', kind: 'button', start: '2026-10-11T10:07:00.000Z' },
    ])
  })

  test('a structured question waits from the ask to its answer, with the card of the turn that asked', () => {
    const text = line({ at: '2026-10-11T09:00:00.000Z', from: 'you', text: 'go', card: 'c' })
    const asks = [
      line({ at: '2026-10-11T09:03:00.000Z', asked: '2026-10-11T09:01:00.000Z', convo: 'x', tool: 'AskUserQuestion' }),
      line({ at: '2026-10-11T09:04:00.000Z', asked: '2026-10-11T09:02:00.000Z', convo: 'x', tool: 'Bash' }),
      line({ at: '2026-10-11T08:00:00.000Z', tool: 'AskUserQuestion' }),
      '{"cut off',
    ].join('\n')
    expect(chatWaits([{ convo: 'x', text }], asks, next)).toEqual([
      { convo: 'x', card: 'c', kind: 'question', start: '2026-10-11T09:01:00.000Z', end: '2026-10-11T09:03:00.000Z' },
    ])
  })

  test('a structured question still in the bar is an open wait, with the card of the turn that asked', () => {
    const text = line({ at: '2026-10-11T09:00:00.000Z', from: 'you', text: 'go', card: 'c' })
    const pending = [
      { at: '2026-10-11T09:01:00.000Z', convo: 'x', tool: 'AskUserQuestion' },
      { at: '2026-10-11T09:02:00.000Z', convo: 'x', tool: 'Bash' },
    ]
    expect(chatWaits([{ convo: 'x', text }], '', next, pending)).toEqual([
      { convo: 'x', card: 'c', kind: 'question', start: '2026-10-11T09:01:00.000Z' },
    ])
  })
})
