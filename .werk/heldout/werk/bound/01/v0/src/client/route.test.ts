import { expect, test } from 'bun:test'
import { cardIdFromPath, cardPath } from './route.ts'

test('a card id makes a path, and the path gives the same id back', () => {
  for (const id of ['werk', 'werk-hmr:opt1', 'a b/c']) expect(cardIdFromPath(cardPath(id))).toBe(id)
  expect(cardPath('werk-hmr:opt1')).toBe('/card/werk-hmr%3Aopt1')
})

test('the root path and any other path name no card', () => {
  expect(cardPath(undefined)).toBe('/')
  for (const path of ['/', '/card/', '/cards/a', '/card/a/b', '/card/%E0%A4%A']) expect(cardIdFromPath(path)).toBeUndefined()
  expect(cardIdFromPath('/card/a/')).toBe('a')
})
