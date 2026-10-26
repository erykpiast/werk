import { describe, expect, test } from 'bun:test'
import type { EventBody } from './events.ts'
import { fold } from './fold.ts'
import { isVisible, listMarked, pageOf } from './view.ts'

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

describe('the staleness listing', () => {
  const marked = map(
    { type: 'added', id: 'a', kind: 'card', title: 'A' },
    { type: 'added', id: 'b', kind: 'card', title: 'B' },
    { type: 'added', id: 'c', kind: 'card', title: 'C', parent: 'a' },
    { type: 'added', id: 'd', kind: 'card', title: 'D' },
    { type: 'added', id: 's', kind: 'source', title: 'S' },
    { type: 'linked', from: 'd', to: 'c', link: 'depends_on' },
    { type: 'linked', from: 'b', to: 'a', link: 'depends_on' },
    { type: 'linked', from: 'd', to: 's', link: 'supported_by' },
    { type: 'decided', id: 'a' },
    { type: 'reopened', id: 'a', reason: 'postponed', why: 'later' },
    { type: 'disputed', id: 's', why: 'old' },
  )
  const rows = (list: ReturnType<typeof listMarked>) => list!.map((row) => `${row.kind} ${row.card.id} ${row.marks.map((m) => m.reason ?? m.change).join(',')}`)

  test('lists each marked card with the reason of each mark, a basis before the card on it', () => {
    expect(rows(listMarked(marked))).toEqual(['paused b postponed', 'paused c postponed', 'paused d postponed', 'review d disputed'])
  })

  test('keeps one kind, and the refines subtree of a card', () => {
    expect(rows(listMarked(marked, { only: 'review' }))).toEqual(['review d disputed'])
    expect(rows(listMarked(marked, { id: 'a' }))).toEqual(['paused c postponed'])
  })

  test('a card comes after the card it depends on, even when the log added it first', () => {
    const late = map(
      { type: 'added', id: 'z', kind: 'card', title: 'Z' },
      { type: 'added', id: 'y', kind: 'card', title: 'Y' },
      { type: 'added', id: 'x', kind: 'card', title: 'X' },
      { type: 'linked', from: 'z', to: 'y', link: 'depends_on' },
      { type: 'linked', from: 'y', to: 'x', link: 'depends_on' },
      { type: 'decided', id: 'x' },
      { type: 'reopened', id: 'x', reason: 'postponed', why: 'later' },
    )
    expect(rows(listMarked(late))).toEqual(['paused y postponed', 'paused z postponed'])
  })

  test('a stale card is listed as stale only', () => {
    const more = map(
      { type: 'added', id: 'a', kind: 'card', title: 'A' },
      { type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a' },
      { type: 'decided', id: 'a' },
      { type: 'reopened', id: 'a', reason: 'postponed', why: 'later' },
      { type: 'retitled', id: 'a', title: 'A2' },
    )
    expect(rows(listMarked(more))).toEqual(['stale b retitled'])
  })

  test('is empty for a map with no marks', () => {
    expect(listMarked(map({ type: 'added', id: 'a', kind: 'card', title: 'A' }))).toEqual([])
  })

  test('leaves out a removed card, and is undefined for a card not in view', () => {
    const removed = map(
      { type: 'added', id: 'a', kind: 'card', title: 'A' },
      { type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a' },
      { type: 'decided', id: 'a' },
      { type: 'reopened', id: 'a', reason: 'rejected', why: 'wrong' },
      { type: 'removed', id: 'b' },
    )
    expect(listMarked(removed)).toEqual([])
    expect(listMarked(removed, { id: 'b' })).toBeUndefined()
  })
})

test('a ghost sits under its proposed parent, with its held edges on its page', () => {
  const state = map(
    { type: 'added', id: 'root', kind: 'card', title: 'Root' },
    { type: 'proposed', id: 'g', kind: 'card', title: 'Ghost', parent: 'root' },
    { type: 'proposed', id: 'g:opt0', kind: 'option', title: 'Opt', alternativeTo: 'g' },
    { type: 'proposed', id: 'e', kind: 'excerpt', title: 'Said', body: 'keep every change' },
    { type: 'linked', from: 'g', to: 'e', link: 'supported_by' },
  )
  expect(ids(pageOf(state)!.children)).toEqual(['root'])
  expect(pageOf(state, 'root')!.children).toEqual([expect.objectContaining({ id: 'g', proposed: true })])
  const page = pageOf(state, 'g')!
  expect(ids(page.trail)).toEqual(['root'])
  expect(ids(page.options)).toEqual(['g:opt0'])
  expect(ids(page.evidence)).toEqual(['e'])
})
