import { afterEach, beforeEach, expect, test } from 'bun:test'
import { expectOneMore, isGhost, isReal, logLines, logText, makeProject, ok, realCard, show, type Project } from './helpers.ts'

let p: Project
beforeEach(() => (p = makeProject()))
afterEach(() => p.cleanup())

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  realCard(p, 'root', 'A root')
  ok(p, ['add', 'other', '--title', 'Another card'])
  const before = logLines(p)
  expect(before.length).toBeGreaterThan(0)
  const add = p.werk(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const afterAdd = logLines(p)
  expectOneMore(before, afterAdd)
  const s1 = show(p, 'c1')
  expect(s1.stdout).toContain('Use a log')
  expect(s1.stdout).toContain('The body text')
  expect(s1.stdout).toContain('The why text')
  expect(isGhost(s1.stdout)).toBe(true)
  const acc = p.werk(['accept', 'c1', '--actor', 'you'])
  expect(acc.code).toBe(0)
  expectOneMore(afterAdd, logLines(p))
  const s2 = show(p, 'c1')
  expect(s2.stdout).toContain('Use a log')
  expect(s2.stdout).toContain('The body text')
  expect(s2.stdout).toContain('The why text')
  expect(isReal(s2.stdout)).toBe(true)
  expect(isGhost(s2.stdout)).toBe(false)
})

test('62.2 an accept without the claim refuses and leaves the ghost waiting', () => {
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  const before = logLines(p)
  const r = p.werk(['accept', 'c1'])
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(isGhost(show(p, 'c1').stdout)).toBe(true)
  ok(p, ['accept', 'c1', '--actor', 'you'])
  expect(isReal(show(p, 'c1').stdout)).toBe(true)
})

test('62.3 the words of a ghost are frozen', () => {
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  let before = logLines(p)
  const e = p.werk(['edit', 'c1', '--body', 'a new body'])
  expect(e.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  before = logLines(p)
  const t = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(t.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  before = logLines(p)
  const a = p.werk(['add', 'c1', '--title', 'Another title'])
  expect(a.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  const s = show(p, 'c1').stdout
  expect(s).toContain('Use a log')
  expect(isGhost(s)).toBe(true)
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  ok(p, ['accept', 'c1', '--actor', 'you'])
  const before = logLines(p)
  const r = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  expectOneMore(before, logLines(p))
  const s = show(p, 'c1').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true)
  expect(logText(p)).toContain('"Use a log"')
  ok(p, ['edit', 'c1', '--body', 'The new body'])
  const s2 = show(p, 'c1').stdout
  expect(s2).toContain('The new body')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  realCard(p, 'top', 'The top card')
  const adds: [string, string[], string[]][] = [
    ['top:opt', ['--kind', 'option', '--title', 'An option', '--why-not', 'It costs too much', '--parent', 'top'], ['An option', 'It costs too much']],
    ['src1', ['--kind', 'source', '--title', 'A source', '--body', 'Source body'], ['A source', 'Source body']],
    ['ex1', ['--kind', 'excerpt', '--title', 'An excerpt', '--body', 'Excerpt body'], ['An excerpt', 'Excerpt body']],
  ]
  for (const [id, flags] of adds) {
    const before = logLines(p)
    const r = p.werk(['add', id, ...flags])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    expectOneMore(before, logLines(p))
  }
  for (const [id, , fields] of adds) {
    const s = show(p, id).stdout
    for (const f of fields) expect(s).toContain(f)
    expect(isGhost(s)).toBe(true)
  }
  ok(p, ['accept', 'top:opt', '--actor', 'you'])
  const o = show(p, 'top:opt').stdout
  expect(isReal(o)).toBe(true)
  expect(o).toContain('why-not: It costs too much')
  expect(isGhost(show(p, 'src1').stdout)).toBe(true)
  expect(isGhost(show(p, 'ex1').stdout)).toBe(true)
})
