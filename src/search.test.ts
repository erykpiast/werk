import { describe, expect, test } from 'bun:test'
import { fold } from './fold.ts'
import { mapIndex, searchMap } from './search.ts'
import type { Event } from './types.ts'

const log = (...events: Array<[Event['type'], Record<string, unknown>]>): Event[] =>
  events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }))

const g = fold(
  log(
    ['node.added', { id: 'root', kind: 'card', title: 'Root', status: 'decided' }],
    ['node.added', { id: 'routes', kind: 'card', title: 'Each view has its own address', body: 'The address is /map/<id>. The address is encoded.', status: 'decided' }],
    ['node.added', { id: 'page', kind: 'card', title: 'One card page', why: 'A page per address.', status: 'open' }],
    ['node.added', { id: 'routes:opt0', kind: 'option', title: 'Hash routes', why_not: 'a hash address breaks the server' }],
    ['node.added', { id: 'other', kind: 'card', title: 'Elsewhere', body: 'address', status: 'decided' }],
    ['node.proposed', { id: 'ghost', kind: 'card', title: 'A ghost address', status: 'decided' }],
    ['edge.added', { from: 'routes', to: 'root', type: 'refines' }],
    ['edge.added', { from: 'page', to: 'root', type: 'refines' }],
    ['edge.added', { from: 'routes:opt0', to: 'routes', type: 'alternative_to' }],
  ),
)

describe('mapIndex', () => {
  test('every live decided card, by id and title; no option, no open card, no ghost', () => {
    expect(mapIndex(g)).toEqual([
      { id: 'root', title: 'Root' },
      { id: 'routes', title: 'Each view has its own address' },
      { id: 'other', title: 'Elsewhere' },
    ])
  })
})

describe('searchMap', () => {
  test('every term must occur, case-insensitive, in the title, why, body or an option why-not; most hits first', () => {
    expect(searchMap(g, ['ADDRESS']).map((h) => [h.id, h.hits])).toEqual([
      ['routes', 4],
      ['page', 1],
      ['other', 1],
    ])
    expect(searchMap(g, ['address', 'hash']).map((h) => h.id)).toEqual(['routes'])
    expect(searchMap(g, ['nothing like this'])).toEqual([])
  })

  test('--status and --under narrow the cards; a ghost never matches', () => {
    expect(searchMap(g, ['address'], { status: 'open' }).map((h) => h.id)).toEqual(['page'])
    expect(searchMap(g, ['address'], { under: 'root' }).map((h) => h.id)).toEqual(['routes', 'page'])
    expect(searchMap(g, ['ghost'])).toEqual([])
  })
})
