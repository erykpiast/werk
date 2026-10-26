import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ok, project, type P } from '../lib.ts'

let p: P
afterEach(() => p?.cleanup())

/** The log grew by exactly one line at the end, and the earlier lines are the same. */
const oneMore = (before: string[]) => {
  const after = p.lines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1 an agent proposes a card and a person accepts it', () => {
  p = project()
  ok(p.w('add', 'seed1', '--title', 'Seed one'))
  ok(p.w('add', 'seed2', '--title', 'Seed two'))
  let before = p.lines()
  const add = p.w('add', 'store', '--title', 'Use a log', '--body', 'The map is a log.', '--why', 'Nothing is lost.')
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  oneMore(before)

  let show = ok(p.w('show', 'store')).stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('The map is a log.')
  expect(show).toContain('Nothing is lost.')
  expect(show).toContain('ghost')

  before = p.lines()
  expect(p.w('accept', 'store', '--actor', 'you').code).toBe(0)
  oneMore(before)
  show = ok(p.w('show', 'store')).stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('The map is a log.')
  expect(show).toContain('Nothing is lost.')
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and the ghost waits', () => {
  p = project()
  ok(p.w('add', 'store', '--title', 'Use a log'))
  const before = p.lines()
  const r = p.w('accept', 'store')
  expect(r.code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  expect(ok(p.w('show', 'store')).stdout).toContain('ghost')
  ok(p.w('accept', 'store', '--actor', 'you'))
  expect(ok(p.w('show', 'store')).stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = project()
  ok(p.w('add', 'store', '--title', 'Use a log'))
  let before = p.lines()
  expect(p.w('edit', 'store', '--body', 'A new body').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  before = p.lines()
  expect(p.w('retitle', 'store', '--title', 'Use an append-only log').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  before = p.lines()
  expect(p.w('add', 'store', '--title', 'Use a database').code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  const show = ok(p.w('show', 'store')).stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = project()
  ok(p.w('add', 'store', '--title', 'Use a log'))
  ok(p.w('accept', 'store', '--actor', 'you'))
  const before = p.lines()
  expect(p.w('retitle', 'store', '--title', 'Use an append-only log').code).toBe(0)
  oneMore(before)
  let show = ok(p.w('show', 'store')).stdout
  expect(show).toContain('Use an append-only log')
  expect(show).not.toContain('Use a log')
  const file = readFileSync(p.logPath, 'utf8').split('\n')
  expect(file[0]).toContain('"Use a log"')
  ok(p.w('edit', 'store', '--body', 'Each change is one line.'))
  show = ok(p.w('show', 'store')).stdout
  expect(show).toContain('Each change is one line.')
  expect(show).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = project()
  ok(p.w('add', 'store', '--title', 'Use a log'))
  ok(p.w('accept', 'store', '--actor', 'you'))
  const adds: [string, string[]][] = [
    ['db', ['--kind', 'option', '--title', 'Use a database', '--why-not', 'Too heavy', '--parent', 'store']],
    ['notes', ['--kind', 'source', '--title', 'Benchmark notes', '--body', 'Some notes']],
    ['quote1', ['--kind', 'excerpt', '--title', 'never delete a line', '--body', 'From the chat']],
  ]
  for (const [id, args] of adds) {
    const before = p.lines()
    const r = p.w('add', id, ...args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    oneMore(before)
  }
  let db = ok(p.w('show', 'db')).stdout
  expect(db).toContain('Use a database')
  expect(db).toContain('Too heavy')
  expect(db).toContain('ghost')
  const notes = ok(p.w('show', 'notes')).stdout
  expect(notes).toContain('Benchmark notes')
  expect(notes).toContain('ghost')
  const q = ok(p.w('show', 'quote1')).stdout
  expect(q).toContain('never delete a line')
  expect(q).toContain('ghost')

  ok(p.w('accept', 'db', '--actor', 'you'))
  db = ok(p.w('show', 'db')).stdout
  expect(db).toContain('state: real')
  expect(db).toContain('why-not: Too heavy')
  expect(ok(p.w('show', 'notes')).stdout).toContain('ghost')
  expect(ok(p.w('show', 'quote1')).stdout).toContain('ghost')
})
