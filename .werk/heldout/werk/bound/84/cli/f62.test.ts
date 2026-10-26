/** Feature 62: ghosts, accept with the person's claim, frozen words. */
import { afterEach, expect, test } from 'bun:test'
import { accepted, expectOneMore, logLines, makeProject, ok, proposed, seed, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const show = (id: string) => p.werk(['show', id])

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  p = makeProject()
  seed(p, proposed('root', { title: 'Root' }), accepted('root'), proposed('other', { title: 'Other' }))
  const before = logLines(p)

  const add = p.werk(['add', 'c1', '--title', 'Use a log', '--body', 'An append-only file.', '--why', 'Nothing is lost.'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const afterAdd = logLines(p)
  expectOneMore(before, afterAdd)

  const shown = show('c1')
  expect(shown.code).toBe(0)
  expect(shown.stdout).toContain('Use a log')
  expect(shown.stdout).toContain('An append-only file.')
  expect(shown.stdout).toContain('Nothing is lost.')
  expect(shown.stdout).toContain('state: ghost')

  const acc = p.werk(['accept', 'c1', '--actor', 'you'])
  expect(acc.code).toBe(0)
  expectOneMore(afterAdd, logLines(p))
  const real = show('c1').stdout
  expect(real).toContain('Use a log')
  expect(real).toContain('An append-only file.')
  expect(real).toContain('Nothing is lost.')
  expect(real).toContain('state: real')
  expect(real).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  const before = logLines(p)
  const r = p.werk(['accept', 'c1'])
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(show('c1').stdout).toContain('state: ghost')
  expect(p.werk(['accept', 'c1', '--actor', 'you']).code).toBe(0)
  expect(show('c1').stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  const before = logLines(p)
  const edit = p.werk(['edit', 'c1', '--body', 'New body'])
  expect(edit.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  const retitle = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(retitle.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  const again = p.werk(['add', 'c1', '--title', 'A different title'])
  expect(again.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  const shown = show('c1').stdout
  expect(shown).toContain('Use a log')
  expect(shown).not.toContain('Use an append-only log')
  expect(shown).toContain('state: ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  ok(p, ['accept', 'c1', '--actor', 'you'])
  const before = logLines(p)
  const r = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  expectOneMore(before, logLines(p))
  const shown = show('c1').stdout
  expect(shown).toContain('Use an append-only log')
  expect(shown).not.toContain('Use a log')
  const lines = logLines(p)
  const firstLine = lines.findIndex((l) => l.includes('"Use a log"'))
  expect(firstLine).toBeGreaterThanOrEqual(0)
  expect(firstLine).toBeLessThan(lines.length - 1)

  expect(p.werk(['edit', 'c1', '--body', 'The new body text.']).code).toBe(0)
  const edited = show('c1').stdout
  expect(edited).toContain('The new body text.')
  expect(edited).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  ok(p, ['add', 'card', '--title', 'The card'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy for one user', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'Numbers from the run.']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'The tool never guesses']],
  ]
  for (const [, args] of adds) {
    const before = logLines(p)
    const r = p.werk(args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    expectOneMore(before, logLines(p))
  }
  const opt = show('opt').stdout
  expect(opt).toContain('Use Postgres')
  expect(opt).toContain('why-not: Too heavy for one user')
  expect(opt).toContain('state: ghost')
  const src = show('src').stdout
  expect(src).toContain('Benchmark notes')
  expect(src).toContain('Numbers from the run.')
  expect(src).toContain('state: ghost')
  const exc = show('exc').stdout
  expect(exc).toContain('The tool never guesses')
  expect(exc).toContain('state: ghost')

  ok(p, ['accept', 'opt', '--actor', 'you'])
  const optReal = show('opt').stdout
  expect(optReal).toContain('state: real')
  expect(optReal).toContain('why-not: Too heavy for one user')
  expect(show('src').stdout).toContain('state: ghost')
  expect(show('exc').stdout).toContain('state: ghost')
})
