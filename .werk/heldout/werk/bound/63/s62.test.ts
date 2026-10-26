import { afterEach, expect, test } from 'bun:test'
import { logLines, logText, makeProject, ok, realCard, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const appendedOne = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  realCard(p, 'seed', 'Seed card')
  ok(p.werk(['say', 'seed', '--text', 'hello']), 'say')
  const before = logLines(p)
  expect(before.length).toBeGreaterThan(0)

  const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const afterAdd = logLines(p)
  appendedOne(before, afterAdd)

  const s1 = show(p, 'use-log')
  expect(s1.code).toBe(0)
  expect(s1.stdout).toContain('Use a log')
  expect(s1.stdout).toContain('The body text')
  expect(s1.stdout).toContain('The why text')
  expect(s1.stdout).toMatch(/ghost/)

  const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
  expect(acc.code).toBe(0)
  appendedOne(afterAdd, logLines(p))

  const s2 = show(p, 'use-log')
  expect(s2.stdout).toContain('Use a log')
  expect(s2.stdout).toContain('The body text')
  expect(s2.stdout).toContain('The why text')
  expect(s2.stdout).toContain('state: real')
  expect(s2.stdout).not.toMatch(/ghost/)
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(p.werk(['add', 'c', '--title', 'A card']), 'add')
  const before = logLines(p)
  const r = p.werk(['accept', 'c'])
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(show(p, 'c').stdout).toMatch(/ghost/)
  ok(p.werk(['accept', 'c', '--actor', 'you']), 'accept with claim')
  const s = show(p, 'c').stdout
  expect(s).toContain('state: real')
  expect(s).not.toMatch(/ghost/)
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(p.werk(['add', 'c', '--title', 'Use a log']), 'add')
  let before = logLines(p)

  expect(p.werk(['edit', 'c', '--body', 'new body']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)

  expect(p.werk(['retitle', 'c', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)

  expect(p.werk(['add', 'c', '--title', 'Another title']).code).not.toBe(0)
  expect(logLines(p)).toEqual(before)

  const s = show(p, 'c').stdout
  expect(s).toContain('Use a log')
  expect(s).toMatch(/ghost/)
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(p.werk(['add', 'c', '--title', 'Use a log']), 'add')
  ok(p.werk(['accept', 'c', '--actor', 'you']), 'accept')
  const before = logLines(p)
  const r = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  appendedOne(before, after)

  const s = show(p, 'c').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const firstLine = after.find((l) => l.includes('"Use a log"'))
  expect(firstLine).toBeDefined()
  expect(after.indexOf(firstLine!)).toBeLessThan(after.length - 1)
  expect(logText(p)).toContain('Use a log')

  ok(p.werk(['edit', 'c', '--body', 'A brand new body']), 'edit body')
  const s2 = show(p, 'c').stdout
  expect(s2).toContain('A brand new body')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  realCard(p, 'card', 'Real card')

  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use files', '--why-not', 'Files lose writes', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'Design notes', '--body', 'Notes body']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'A quoted line', '--body', 'Excerpt body']],
  ]
  for (const [, args] of adds) {
    const before = logLines(p)
    const r = p.werk(args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    appendedOne(before, logLines(p))
  }

  const so = show(p, 'opt').stdout
  expect(so).toContain('Use files')
  expect(so).toContain('Files lose writes')
  expect(so).toMatch(/ghost/)
  const ss = show(p, 'src').stdout
  expect(ss).toContain('Design notes')
  expect(ss).toContain('Notes body')
  expect(ss).toMatch(/ghost/)
  const se = show(p, 'exc').stdout
  expect(se).toContain('A quoted line')
  expect(se).toContain('Excerpt body')
  expect(se).toMatch(/ghost/)

  ok(p.werk(['accept', 'opt', '--actor', 'you']), 'accept option')
  const so2 = show(p, 'opt').stdout
  expect(so2).toContain('state: real')
  expect(so2).toContain('why-not: Files lose writes')
  expect(show(p, 'src').stdout).toMatch(/ghost/)
  expect(show(p, 'exc').stdout).toMatch(/ghost/)
})
