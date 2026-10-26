import { expect, test } from 'bun:test'
import { describeEvent, eventIds } from './events.ts'

const at = '2026-10-19T00:00:00.000Z'

test('a line names the place, the type and the card of an event', () => {
  expect(describeEvent({ type: 'retitled', id: 'a', title: 'Use an append-only log', seq: 4, at })).toBe('4 retitled #a')
  expect(describeEvent({ type: 'decided', id: 'a', seq: 5, at })).toBe('5 decided #a')
})

test('a line for a link names both ends and the link type', () => {
  expect(describeEvent({ type: 'linked', from: 'b', to: 'a', link: 'refines', seq: 3, at })).toBe('3 linked #b refines #a')
  expect(describeEvent({ type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a', seq: 2, at })).toBe('2 added #b refines #a')
})

test('an event is about its card, and a link is about both ends', () => {
  expect(eventIds({ type: 'removed', id: 'b' })).toEqual(['b'])
  expect(eventIds({ type: 'linked', from: 'b', to: 'a', link: 'depends_on' })).toEqual(['b', 'a'])
  expect(eventIds({ type: 'added', id: 'b', kind: 'card', title: 'B', parent: 'a' })).toEqual(['b', 'a'])
})
