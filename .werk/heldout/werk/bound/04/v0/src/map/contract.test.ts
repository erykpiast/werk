import { describe, expect, test } from 'bun:test'
import { parseArgs } from '../args.ts'
import { contractCheck, missingFacts } from './contract.ts'
import type { EventBody, LogEvent } from './events.ts'
import { fold } from './fold.ts'

const log = (...bodies: EventBody[]): LogEvent[] => bodies.map((body, i) => ({ ...body, seq: i + 1, at: '2026-10-19T00:00:00.000Z' }))

const card = (id: string, extra: Partial<Extract<EventBody, { type: 'added' }>> = {}): EventBody => ({ type: 'added', id, kind: 'card', title: id, ...extra })
const who = (id: string, value: string): EventBody => ({ type: 'recorded', id, fact: 'who', value })
const noBasis = (id: string): EventBody => ({ type: 'recorded', id, fact: 'noBasis', value: 'the root of the map' })
const kill = (id: string): EventBody => ({ type: 'killAdded', id, text: 'revisit at any time' })
const decide = (id: string): EventBody => ({ type: 'decided', id })
const facts = (state: ReturnType<typeof fold>, id: string) => missingFacts(state, id).map((m) => m.fact)

/** A `me` card with every fact: who, a decided basis, and a kill criterion. */
const ready = [card('base'), noBasis('base'), who('base', 'me'), kill('base'), decide('base'), card('a', { parent: 'base', who: 'me' }), kill('a')]

describe('the four facts (#werk-contract-facts)', () => {
  test('a new card misses who, basis and kill; options are asked only once who is you', () => {
    expect(facts(fold(log(card('a'))), 'a')).toEqual(['who', 'basis', 'kill'])
    expect(facts(fold(log(card('a', { who: 'you' }))), 'a')).toEqual(['basis', 'options', 'kill'])
    expect(facts(fold(log(card('a', { who: 'prototype' }))), 'a')).toEqual(['basis', 'kill'])
  })

  test('a card with every fact misses nothing', () => {
    expect(missingFacts(fold(log(...ready)), 'a')).toEqual([])
  })

  test('each missing fact prints its own command, with the card id filled in', () => {
    const missing = missingFacts(fold(log(card('a', { who: 'you' }))), 'a')
    expect(missingFacts(fold(log(card('a'))), 'a')[0]).toEqual({
      fact: 'who',
      reason: 'who decides #a is not recorded.',
      fix: 'werk edit a --who <you|me|prototype>',
    })
    expect(missing.map((m) => m.fix)).toEqual([
      'werk link a <card-it-needs> --type depends_on --why "<what #a takes from it>"',
      'werk add a:opt0 --kind option --title "<the alternative>" --why-not "<why it lost>" --alternative-to a',
      'werk kill a "<what must become true to revisit this decision>"',
    ])
  })

  test('every printed fix is a command the parser reads as a write', () => {
    const all = [
      ...missingFacts(fold(log(card('a'))), 'a'),
      ...missingFacts(fold(log(card('a', { who: 'you' }))), 'a'),
      ...missingFacts(fold(log(card('p'), card('a', { parent: 'p' }))), 'a'),
    ]
    for (const { fix } of all) {
      // A shell reads each quoted placeholder as one word; the bare placeholders get a value.
      const words = fix
        .replace('<you|me|prototype>', 'me')
        .replace('<card-it-needs>', 'p')
        .match(/"[^"]*"|\S+/g)!
        .map((w) => w.replace(/^"|"$/g, ''))
      expect({ fix, words: words[0], kind: parseArgs(words.slice(1)).kind }).toEqual({ fix, words: 'werk', kind: 'write' })
    }
  })

  test('the escape hatch of a waivable fact is named in its reason', () => {
    const missing = missingFacts(fold(log(card('a', { who: 'you' }))), 'a')
    expect(missing.find((m) => m.fact === 'basis')!.reason).toContain('--no-basis')
    expect(missing.find((m) => m.fact === 'options')!.reason).toContain('--unchallenged')
  })

  test('the option fix names the next free option id', () => {
    const state = fold(log(card('a', { who: 'you' }), { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', whyNot: 'slow' }))
    expect(missingFacts(state, 'a').find((m) => m.fact === 'options')!.fix).toContain('werk add a:opt1 ')
  })
})

describe('the basis', () => {
  test('a decided depends_on target is a basis', () => {
    const state = fold(log(...ready, card('b', { who: 'me' }), kill('b'), { type: 'linked', from: 'b', to: 'base', link: 'depends_on' }))
    expect(facts(state, 'b')).toEqual([])
  })

  test('a paused basis still holds; the postponed card itself is open, so a card on it waits (#pr-wf-paused)', () => {
    const chain = [
      ...ready,
      card('b', { who: 'me' }), kill('b'), { type: 'linked', from: 'b', to: 'base', link: 'depends_on' }, decide('b'),
      card('c', { who: 'me' }), kill('c'), { type: 'linked', from: 'c', to: 'b', link: 'depends_on' },
      { type: 'reopened', id: 'base', reason: 'postponed', why: 'later' },
    ] satisfies EventBody[]
    const state = fold(log(...chain))
    expect(state.cards.b!.paused).not.toEqual([])
    expect(facts(state, 'c')).toEqual([])
    expect(facts(state, 'b')).toEqual(['basis'])
  })

  test('a recorded lack of basis is a basis', () => {
    expect(facts(fold(log(card('a', { who: 'me' }), noBasis('a'), kill('a'))), 'a')).toEqual([])
  })

  test('an open basis makes the card wait, and the fix decides that basis', () => {
    const state = fold(log(card('p'), card('a', { parent: 'p', who: 'me' }), kill('a')))
    expect(missingFacts(state, 'a')).toEqual([{ fact: 'basis', reason: '#a waits on its basis: #p is open.', fix: 'werk status p decided' }])
  })

  test('a stale basis makes the card wait too', () => {
    const state = fold(log(...ready, card('up'), { type: 'linked', from: 'base', to: 'up', link: 'depends_on' }, { type: 'retitled', id: 'up', title: 'U' }))
    expect(missingFacts(state, 'a')[0]).toMatchObject({ fact: 'basis', reason: '#a waits on its basis: #base is stale.', fix: 'werk status base decided' })
  })

  test('a removed card is no basis', () => {
    expect(facts(fold(log(...ready, { type: 'removed', id: 'base' })), 'a')).toEqual(['basis'])
  })
})

describe('the options', () => {
  const you = [card('a', { who: 'you' }), noBasis('a'), kill('a')]

  test('a linked option satisfies a you card', () => {
    const state = fold(log(...you, { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', whyNot: 'slow', alternativeTo: 'a' }))
    expect(facts(state, 'a')).toEqual([])
  })

  test('a removed option does not count', () => {
    const state = fold(log(...you, { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', alternativeTo: 'a' }, { type: 'removed', id: 'a:opt0' }))
    expect(facts(state, 'a')).toEqual(['options'])
  })

  test('a recorded unchallenged statement satisfies a you card', () => {
    expect(facts(fold(log(...you, { type: 'recorded', id: 'a', fact: 'unchallenged', value: 'only one way was seen' })), 'a')).toEqual([])
  })
})

describe('contractCheck: when the check runs (#werk-contract-when)', () => {
  test('the move to decided runs the facts and lists each missing one with its command', () => {
    const message = contractCheck(fold(log(card('a'))), decide('a'))
    expect(message).toBe(
      [
        '#a cannot be decided: 3 facts are missing.',
        '  who decides #a is not recorded.',
        '    werk edit a --who <you|me|prototype>',
        '  #a has no basis: no depends_on target and no decided parent. A card that needs none records why with edit --no-basis.',
        '    werk link a <card-it-needs> --type depends_on --why "<what #a takes from it>"',
        '  #a has no kill criterion.',
        '    werk kill a "<what must become true to revisit this decision>"',
      ].join('\n'),
    )
  })

  test('a card with every fact moves to decided', () => {
    expect(contractCheck(fold(log(...ready)), decide('a'))).toBeUndefined()
  })

  test('creation, a reopen, a record and an excerpt are not checked', () => {
    const state = fold(log(card('a')))
    for (const event of [card('b'), who('a', 'you'), kill('a'), { type: 'said', id: 'a', who: 'E', text: 'x' } as EventBody]) {
      expect(contractCheck(state, event)).toBeUndefined()
    }
    const decided = fold(log(...ready, decide('a')))
    expect(contractCheck(decided, { type: 'reopened', id: 'a', reason: 'postponed', why: 'later' })).toBeUndefined()
  })

  test('the text of a card is not checked', () => {
    const state = fold(log(...ready, decide('a')))
    expect(contractCheck(state, { type: 'edited', id: 'a', field: 'body', text: '' })).toBeUndefined()
    expect(contractCheck(state, { type: 'retitled', id: 'a', title: 'x' })).toBeUndefined()
  })
})

describe('contractCheck: an amend of a decided card runs the facts again (#map-frozen)', () => {
  const decidedYou = [card('a', { who: 'you' }), noBasis('a'), kill('a'), { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', alternativeTo: 'a' } as EventBody, decide('a')]

  test('removing the last option of a decided you card is refused', () => {
    const message = contractCheck(fold(log(...decidedYou)), { type: 'removed', id: 'a:opt0' })
    expect(message).toStartWith('the change to #a is refused: #a is decided, and after it 1 fact is missing.\n')
    expect(message).toContain('werk add a:opt1 --kind option')
  })

  test('a who of you on a decided me card with no option is refused', () => {
    expect(contractCheck(fold(log(...ready, decide('a'))), who('a', 'you'))).toStartWith('the change to #a is refused')
  })

  test('an amend that keeps every fact passes', () => {
    const state = fold(log(...decidedYou))
    expect(contractCheck(state, who('a', 'me'))).toBeUndefined()
    expect(contractCheck(state, { type: 'retitled', id: 'a', title: 'A' })).toBeUndefined()
  })

  test('the same change to an open card is not checked', () => {
    const open = fold(log(...decidedYou.slice(0, -1)))
    expect(contractCheck(open, { type: 'removed', id: 'a:opt0' })).toBeUndefined()
  })

  test('a card decided before a fact was required waits on its next amend', () => {
    const legacy = fold(log(card('a'), decide('a')))
    expect(contractCheck(legacy, { type: 'retitled', id: 'a', title: 'A' })).toStartWith('the change to #a is refused: #a is decided, and after it 3 facts are missing.')
  })

  test('the fixes for a card decided before the contract each go through, and then a retitle does', () => {
    const events = [card('a'), decide('a')]
    for (const fix of [who('a', 'me'), noBasis('a'), kill('a')]) {
      expect(contractCheck(fold(log(...events)), fix)).toBeUndefined()
      events.push(fix)
    }
    expect(contractCheck(fold(log(...events)), { type: 'retitled', id: 'a', title: 'A' })).toBeUndefined()
  })

  test('a free link, such as a source, does not wait on the facts the card already missed', () => {
    const legacy = fold(log(card('a'), { type: 'added', id: 's', kind: 'source', title: 's' }, decide('a')))
    expect(contractCheck(legacy, { type: 'linked', from: 'a', to: 's', link: 'supported_by' })).toBeUndefined()
    expect(contractCheck(legacy, { type: 'linked', from: 'a', to: 's', link: 'depends_on' })).toStartWith('the change to #a is refused')
  })

  test('an event the fold refuses is left to the fold', () => {
    expect(contractCheck(fold(log(...decidedYou)), { type: 'recorded', id: 'a', fact: 'who', value: 'nobody' })).toBeUndefined()
  })
})

describe('a ghost is checked over its held edges (#werk-propose-new)', () => {
  const ghost = (id: string, extra: Partial<Extract<EventBody, { type: 'proposed' }>> = {}): EventBody => ({ type: 'proposed', id, kind: 'card', title: id, ...extra })
  const base = [card('base'), noBasis('base'), who('base', 'me'), kill('base'), decide('base')]

  test('a ghost whose held edges supply every fact moves to decided, and stays a ghost', () => {
    const events = [...base, ghost('g', { who: 'you' }), { type: 'linked', from: 'g', to: 'base', link: 'depends_on' } as EventBody, ghost('g:opt0', { kind: 'option', whyNot: 'slow', alternativeTo: 'g' }), kill('g')]
    const state = fold(log(...events))
    expect(contractCheck(state, decide('g'))).toBeUndefined()
    const decided = fold(log(...events, decide('g')))
    expect(decided.cards.g).toMatchObject({ status: 'decided', proposed: true })
  })

  test('a ghost under a ghost parent that is decided has its basis', () => {
    const state = fold(log(...base, ghost('p', { parent: 'base', who: 'me' }), kill('p'), decide('p'), ghost('c', { parent: 'p', who: 'me' }), kill('c')))
    expect(facts(state, 'c')).toEqual([])
  })

  test('a ghost set to decided with a missing fact fails the check over its held edges', () => {
    const state = fold(log(...base, ghost('g', { who: 'you', parent: 'base' })))
    expect(contractCheck(state, decide('g'))).toBe(
      [
        '#g cannot be decided: 2 facts are missing.',
        '  #g is yours to decide, and no option weighed against it is recorded. A card with none records why with edit --unchallenged.',
        '    werk add g:opt0 --kind option --title "<the alternative>" --why-not "<why it lost>" --alternative-to g',
        '  #g has no kill criterion.',
        '    werk kill g "<what must become true to revisit this decision>"',
      ].join('\n'),
    )
  })

  test('a ghost option and a held depends_on edge do not count for a real card', () => {
    const state = fold(
      log(...base, card('a', { who: 'you' }), kill('a'), ghost('d', { who: 'me', parent: 'base' }), kill('d'), decide('d'), { type: 'linked', from: 'a', to: 'd', link: 'depends_on' }, ghost('a:opt0', { kind: 'option', alternativeTo: 'a' })),
    )
    expect(facts(state, 'a')).toEqual(['basis', 'options'])
  })
})
