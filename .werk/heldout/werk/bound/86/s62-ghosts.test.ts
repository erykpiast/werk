import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { readFileSync } from 'node:fs'
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  c = newCtx()
  c.real('base', 'An earlier card')
  c.ok('say', 'base', '--text', 'an earlier note')
  expect(c.lines().length).toBeGreaterThan(0)

  const add = c.appendsOne('add', 'use-log', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text')
  expect(add.stdout).toContain('proposed')

  const ghost = c.show('use-log').stdout
  expect(ghost).toContain('Use a log')
  expect(ghost).toContain('The body text')
  expect(ghost).toContain('The why text')
  expect(ghost).toContain('ghost')

  const acc = c.appendsOne('accept', 'use-log', '--actor', 'you')
  expect(acc.code).toBe(0)

  const real = c.show('use-log').stdout
  expect(real).toContain('Use a log')
  expect(real).toContain('The body text')
  expect(real).toContain('The why text')
  expect(real).toContain('state: real')
  expect(real).not.toContain('ghost')
})

test('62.2 an accept without the claim refuses and leaves the ghost waiting', () => {
  c = newCtx()
  c.ok('add', 'g', '--title', 'A ghost')
  c.refuses('accept', 'g')
  expect(c.show('g').stdout).toContain('state: ghost')
  c.ok('accept', 'g', '--actor', 'you')
  expect(c.show('g').stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  c = newCtx()
  c.ok('add', 'g', '--title', 'Use a log')
  c.refuses('edit', 'g', '--body', 'new body')
  c.refuses('retitle', 'g', '--title', 'Use an append-only log')
  c.refuses('add', 'g', '--title', 'Another title')
  const s = c.show('g').stdout
  expect(s).toContain('#g  Use a log')
  expect(s).toContain('state: ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  c = newCtx()
  c.ok('add', 'g', '--title', 'Use a log')
  c.ok('accept', 'g', '--actor', 'you')
  c.appendsOne('retitle', 'g', '--title', 'Use an append-only log')
  const s = c.show('g').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const lines = c.lines()
  expect(lines.slice(0, -1).some((l) => l.includes('"Use a log"'))).toBe(true)
  expect(readFileSync(c.logFile, 'utf8')).toContain('Use a log')
  c.ok('edit', 'g', '--body', 'A brand new body')
  const s2 = c.show('g').stdout
  expect(s2).toContain('A brand new body')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  c = newCtx()
  c.real('card', 'The real card')
  const opt = c.appendsOne('add', 'opt', '--kind', 'option', '--title', 'The option', '--why-not', 'It costs too much', '--parent', 'card')
  const src = c.appendsOne('add', 'src', '--kind', 'source', '--title', 'The source', '--body', 'Source notes')
  const ex = c.appendsOne('add', 'ex', '--kind', 'excerpt', '--title', 'The excerpt', '--body', 'Quoted words')
  for (const r of [opt, src, ex]) expect(r.stdout).toContain('proposed')

  const o = c.show('opt').stdout
  expect(o).toContain('The option')
  expect(o).toContain('why-not: It costs too much')
  expect(o).toContain('ghost')
  const s = c.show('src').stdout
  expect(s).toContain('The source')
  expect(s).toContain('Source notes')
  expect(s).toContain('ghost')
  const e = c.show('ex').stdout
  expect(e).toContain('The excerpt')
  expect(e).toContain('Quoted words')
  expect(e).toContain('ghost')

  c.ok('accept', 'opt', '--actor', 'you')
  const o2 = c.show('opt').stdout
  expect(o2).toContain('state: real')
  expect(o2).toContain('why-not: It costs too much')
  expect(c.show('src').stdout).toContain('state: ghost')
  expect(c.show('ex').stdout).toContain('state: ghost')
})
