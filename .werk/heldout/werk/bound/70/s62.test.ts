import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { accepted, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** Runs a werk command and checks that the log grew by exactly one line at the end. */
function appendsOne(args: string[]) {
  const before = p.lines()
  const r = p.werk(args)
  const after = p.lines()
  expect(r.code).toBe(0)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
function refuses(args: string[]) {
  const before = p.lines()
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  expect(p.lines()).toEqual(before)
  return r
}

test('62.1 an agent proposes a card and a person accepts it', () => {
  p = project()
  p.writeLog([proposed('root'), accepted('root'), proposed('other', { parent: 'root' })])
  const add = appendsOne(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.stdout).toContain('proposed')
  const ghost = p.werk(['show', 'c1'])
  expect(ghost.code).toBe(0)
  for (const s of ['Use a log', 'The body text', 'The why text', 'ghost']) expect(ghost.stdout).toContain(s)
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const real = p.werk(['show', 'c1']).stdout
  for (const s of ['Use a log', 'The body text', 'The why text', 'state: real']) expect(real).toContain(s)
  expect(real).not.toContain('ghost')
})

test('62.2 an accept without the claim refuses', () => {
  p = project()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  refuses(['accept', 'c1'])
  expect(p.werk(['show', 'c1']).stdout).toContain('ghost')
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const real = p.werk(['show', 'c1']).stdout
  expect(real).toContain('state: real')
  expect(real).not.toContain('ghost')
})

test('62.3 the words of a ghost are frozen', () => {
  p = project()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  refuses(['edit', 'c1', '--body', 'new body'])
  refuses(['retitle', 'c1', '--title', 'Use an append-only log'])
  refuses(['add', 'c1', '--title', 'Another title'])
  const show = p.werk(['show', 'c1']).stdout
  expect(show).toContain('Use a log')
  expect(show).toContain('ghost')
})

test('62.4 a retitle on a real card', () => {
  p = project()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  appendsOne(['accept', 'c1', '--actor', 'you'])
  appendsOne(['retitle', 'c1', '--title', 'Use an append-only log'])
  const show = p.werk(['show', 'c1']).stdout
  expect(show).toContain('Use an append-only log')
  expect(show).not.toContain('Use a log')
  const firstLine = readFileSync(p.logPath, 'utf8').split('\n')[0]!
  expect(firstLine).toContain('"Use a log"')
  appendsOne(['edit', 'c1', '--body', 'A new body'])
  const after = p.werk(['show', 'c1']).stdout
  expect(after).toContain('A new body')
  expect(after).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt enter as ghosts', () => {
  p = project()
  p.writeLog([proposed('card'), accepted('card')])
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'too heavy', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'Benchmark notes']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'A quoted line']],
  ]
  for (const [, args] of adds) expect(appendsOne(args).stdout).toContain('proposed')
  const opt = p.werk(['show', 'opt']).stdout
  expect(opt).toContain('Use Postgres')
  expect(opt).toContain('too heavy')
  expect(opt).toContain('ghost')
  expect(p.werk(['show', 'src']).stdout).toContain('Benchmark notes')
  expect(p.werk(['show', 'src']).stdout).toContain('ghost')
  expect(p.werk(['show', 'exc']).stdout).toContain('A quoted line')
  expect(p.werk(['show', 'exc']).stdout).toContain('ghost')
  appendsOne(['accept', 'opt', '--actor', 'you'])
  const real = p.werk(['show', 'opt']).stdout
  expect(real).toContain('state: real')
  expect(real).toContain('why-not: too heavy')
  expect(p.werk(['show', 'src']).stdout).toContain('ghost')
  expect(p.werk(['show', 'exc']).stdout).toContain('ghost')
})
