import { afterEach, expect, test } from 'bun:test'
import { project, realCard, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const appendedOne = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1 an agent proposes a card and a person accepts it', () => {
  p = project()
  realCard(p, 'seed', 'Seed card')
  let before = p.lines()
  expect(before.length).toBeGreaterThan(0)
  const add = p.werk(['add', 'c1', '--title', 'Card one', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  appendedOne(before, p.lines())
  let s = p.show('c1')
  expect(s).toContain('Card one')
  expect(s).toContain('The body text')
  expect(s).toContain('The why text')
  expect(s).toContain('ghost')
  before = p.lines()
  const acc = p.werk(['accept', 'c1', '--actor', 'you'])
  expect(acc.code).toBe(0)
  appendedOne(before, p.lines())
  s = p.show('c1')
  expect(s).toContain('Card one')
  expect(s).toContain('The body text')
  expect(s).toContain('The why text')
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
})

test('62.2 an accept without the claim refuses', () => {
  p = project()
  p.ok(['add', 'c1', '--title', 'Card one'])
  const before = p.lines()
  const r = p.werk(['accept', 'c1'])
  expect(r.code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.show('c1')).toContain('ghost')
  expect(p.werk(['accept', 'c1', '--actor', 'you']).code).toBe(0)
  expect(p.show('c1')).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = project()
  p.ok(['add', 'c1', '--title', 'Use a log'])
  let before = p.lines()
  expect(p.werk(['edit', 'c1', '--body', 'new body']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.werk(['retitle', 'c1', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(p.werk(['add', 'c1', '--title', 'Other title']).code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  const s = p.show('c1')
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 a retitle on a real card', () => {
  p = project()
  p.ok(['add', 'c1', '--title', 'Use a log'])
  p.ok(['accept', 'c1', '--actor', 'you'])
  const before = p.lines()
  expect(p.werk(['retitle', 'c1', '--title', 'Use an append-only log']).code).toBe(0)
  appendedOne(before, p.lines())
  let s = p.show('c1')
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(p.lines()[0]).toContain('"title":"Use a log"')
  expect(p.werk(['edit', 'c1', '--body', 'A brand new body']).code).toBe(0)
  s = p.show('c1')
  expect(s).toContain('A brand new body')
  expect(s).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt enter as ghosts', () => {
  p = project()
  realCard(p, 'card', 'Real card')
  const adds: [string, string[]][] = [
    ['opt', ['--kind', 'option', '--title', 'An option', '--why-not', 'It is too slow', '--parent', 'card']],
    ['src', ['--kind', 'source', '--title', 'A source', '--body', 'source body']],
    ['ex', ['--kind', 'excerpt', '--title', 'An excerpt', '--body', 'excerpt body']],
  ]
  for (const [id, args] of adds) {
    const before = p.lines()
    const r = p.werk(['add', id, ...args])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    appendedOne(before, p.lines())
  }
  expect(p.show('opt')).toContain('It is too slow')
  expect(p.show('opt')).toContain('ghost')
  expect(p.show('src')).toContain('source body')
  expect(p.show('src')).toContain('ghost')
  expect(p.show('ex')).toContain('excerpt body')
  expect(p.show('ex')).toContain('ghost')
  expect(p.werk(['accept', 'opt', '--actor', 'you']).code).toBe(0)
  expect(p.show('opt')).toContain('state: real')
  expect(p.show('opt')).toContain('why-not: It is too slow')
  expect(p.show('src')).toContain('ghost')
  expect(p.show('ex')).toContain('ghost')
})
