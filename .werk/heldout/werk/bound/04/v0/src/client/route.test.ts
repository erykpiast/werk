import { expect, test } from 'bun:test'
import { cardHash, cardIdFromHash } from './route.ts'

test('a card id makes a hash, and the hash gives the same id back', () => {
  for (const id of ['werk', 'werk-hmr:opt1', 'a b/c', 'é']) expect(cardIdFromHash(cardHash(id))).toBe(id)
  expect(cardHash('werk-hmr:opt1')).toBe('#werk-hmr%3Aopt1')
})

test('a hash typed by hand, without encoding, still names its card', () => {
  expect(cardIdFromHash('#werk-hmr:opt1')).toBe('werk-hmr:opt1')
  expect(cardIdFromHash('werk')).toBe('werk')
})

test('no hash, an empty hash and a hash that does not decode name no card', () => {
  expect(cardHash(undefined)).toBe('#')
  for (const hash of ['', '#', '#%E0%A4%A']) expect(cardIdFromHash(hash)).toBeUndefined()
})
