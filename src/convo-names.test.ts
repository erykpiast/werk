import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { dirFor, nameForCard } from './convo-names.ts'

describe('dirFor', () => {
  const werk = dirname(process.env.WERK_LOG!)
  test('main lives in .werk itself, the layout before multichat', () => {
    expect(dirFor('main')).toBe(werk)
  })
  test('every other conversation lives under .werk/conversations', () => {
    expect(dirFor('werk-test')).toBe(join(werk, 'conversations', 'werk-test'))
  })
})

describe('nameForCard', () => {
  test('a free card id is its own name', () => {
    expect(nameForCard('werk-test', new Set(['main']))).toBe('werk-test')
  })
  test('a taken one counts up from -2 until it is free', () => {
    expect(nameForCard('c', new Set(['c', 'c-2', 'c-3']))).toBe('c-4')
  })
  test('an option id keeps its colon', () => {
    expect(nameForCard('pr-iface:opt0', new Set())).toBe('pr-iface:opt0')
  })
  test('a string that could leave conversations/ is refused, not used as a path', () => {
    for (const bad of ['../../x', 'a/b', '.hidden', '..', '', 'a b']) {
      expect(() => nameForCard(bad, new Set())).toThrow('not a card id')
    }
  })
})
