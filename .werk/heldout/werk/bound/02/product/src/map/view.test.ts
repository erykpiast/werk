import { expect, test } from 'bun:test'
import type { EventBody } from './events.ts'
import { fold } from './fold.ts'
import { isVisible, pageOf } from './view.ts'

const map = (...bodies: EventBody[]) => fold(bodies.map((body, i) => ({ ...body, seq: i + 1, at: '' })))
const ids = (cards: { id: string }[]) => cards.map((c) => c.id)

const demo = map(
  { type: 'added', id: 'root', kind: 'card', title: 'Root' },
  { type: 'added', id: 'mid', kind: 'card', title: 'Mid' },
  { type: 'added', id: 'leaf', kind: 'card', title: 'Leaf' },
  { type: 'added', id: 'other', kind: 'card', title: 'Other' },
  { type: 'added', id: 'src', kind: 'source', title: 'Finding' },
  { type: 'added', id: 'mid:opt0', kind: 'option', title: 'Opt', whyNot: 'too slow' },
  { type: 'linked', from: 'mid', to: 'root', link: 'refines' },
  { type: 'linked', from: 'leaf', to: 'mid', link: 'refines' },
  { type: 'linked', from: 'mid', to: 'other', link: 'depends_on' },
  { type: 'linked', from: 'mid', to: 'src', link: 'supported_by' },
  { type: 'linked', from: 'mid:opt0', to: 'mid', link: 'alternative_to' },
)

test('the root page lists the top-level cards, never an option or a source that is evidence', () => {
  const page = pageOf(demo)!
  expect(page.card).toBeUndefined()
  expect(ids(page.children)).toEqual(['root', 'other'])
  const loose = map({ type: 'added', id: 's', kind: 'source', title: 'S' })
  expect(ids(pageOf(loose)!.children)).toEqual(['s'])
})

test('a card page has its trail, sub-cards, dependencies, evidence and options', () => {
  const page = pageOf(demo, 'mid')!
  expect(page.card!.title).toBe('Mid')
  expect(ids(page.trail)).toEqual(['root'])
  expect(ids(page.children)).toEqual(['leaf'])
  expect(ids(page.dependsOn)).toEqual(['other'])
  expect(ids(page.evidence)).toEqual(['src'])
  expect(ids(page.options)).toEqual(['mid:opt0'])
})

test('a leaf and a source get the same page shape', () => {
  const leaf = pageOf(demo, 'leaf')!
  expect(ids(leaf.trail)).toEqual(['root', 'mid'])
  expect(leaf.children).toEqual([])
  const src = pageOf(demo, 'src')!
  expect(Object.keys(src)).toEqual(Object.keys(leaf))
  expect(ids(src.supports)).toEqual(['mid'])
})

test('a removed card and its subtree leave the view, and come back on restore', () => {
  const removed = map(...[{ type: 'added', id: 'a', kind: 'card', title: 'A' }, { type: 'added', id: 'b', kind: 'card', title: 'B' }, { type: 'linked', from: 'b', to: 'a', link: 'refines' }, { type: 'removed', id: 'a' }] as EventBody[])
  expect(isVisible(removed, 'b')).toBe(false)
  expect(pageOf(removed, 'a')).toBeUndefined()
  expect(pageOf(removed)!.children).toEqual([])
  expect(pageOf(removed, 'nope')).toBeUndefined()
})
