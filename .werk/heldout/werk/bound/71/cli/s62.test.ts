import { afterEach, expect, test } from 'bun:test'
import { expectOneAppended, isGhost, isReal, logLines, makeProject, ok, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  ok(p, ['add', 'seed', '--title', 'Seed card'])
  ok(p, ['say', 'seed', '--text', 'a note'])
  let before = logLines(p)
  expect(before.length).toBeGreaterThan(0)
  const add = ok(p, ['add', 'log-card', '--title', 'Use a log', '--body', 'Keep every change as a line', '--why', 'The map must keep its history'])
  expect(add.stdout).toContain('proposed')
  let after = logLines(p)
  expectOneAppended(before, after)

  let s = show(p, 'log-card')
  expect(s).toContain('Use a log')
  expect(s).toContain('Keep every change as a line')
  expect(s).toContain('The map must keep its history')
  expect(s).toContain('ghost')

  before = after
  ok(p, ['accept', 'log-card', '--actor', 'you'])
  after = logLines(p)
  expectOneAppended(before, after)
  s = show(p, 'log-card')
  expect(s).toContain('Use a log')
  expect(s).toContain('Keep every change as a line')
  expect(s).toContain('The map must keep its history')
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Card one'])
  const before = logLines(p)
  const r = p.werk(['accept', 'c1'])
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(isGhost(p, 'c1')).toBe(true)
  ok(p, ['accept', 'c1', '--actor', 'you'])
  expect(isReal(p, 'c1')).toBe(true)
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  let before = logLines(p)
  expect(p.werk(['edit', 'c1', '--body', 'new body']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['retitle', 'c1', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['add', 'c1', '--title', 'Another title']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  const s = show(p, 'c1')
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log', '--body', 'old body'])
  ok(p, ['accept', 'c1', '--actor', 'you'])
  const before = logLines(p)
  ok(p, ['retitle', 'c1', '--title', 'Use an append-only log'])
  const after = logLines(p)
  expectOneAppended(before, after)
  const s = show(p, 'c1')
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(after.slice(0, before.length).some((l) => l.includes('"Use a log"'))).toBe(true)
  ok(p, ['edit', 'c1', '--body', 'The new body text'])
  const s2 = show(p, 'c1')
  expect(s2).toContain('The new body text')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  ok(p, ['add', 'root', '--title', 'Root card'])
  ok(p, ['accept', 'root', '--actor', 'you'])
  const adds: [string, string[]][] = [
    ['opt1', ['add', 'opt1', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy', '--parent', 'root']],
    ['src1', ['add', 'src1', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'source body']],
    ['ex1', ['add', 'ex1', '--kind', 'excerpt', '--title', 'A quoted line', '--body', 'excerpt body']],
  ]
  for (const [, args] of adds) {
    const before = logLines(p)
    const r = ok(p, args)
    expect(r.stdout).toContain('proposed')
    expectOneAppended(before, logLines(p))
  }
  expect(show(p, 'opt1')).toContain('Use Postgres')
  expect(show(p, 'opt1')).toContain('Too heavy')
  expect(show(p, 'src1')).toContain('Benchmark notes')
  expect(show(p, 'ex1')).toContain('A quoted line')
  for (const [id] of adds) expect(isGhost(p, id)).toBe(true)

  ok(p, ['accept', 'opt1', '--actor', 'you'])
  const o = show(p, 'opt1')
  expect(o).toContain('state: real')
  expect(o).toContain('why-not: Too heavy')
  expect(isGhost(p, 'src1')).toBe(true)
  expect(isGhost(p, 'ex1')).toBe(true)
})
