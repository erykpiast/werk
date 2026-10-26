import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

let p: Project
afterEach(() => p?.cleanup())

const lines = () => {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}
const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} -> ${r.code}: ${r.stderr}`)
  return r
}
/** Runs werk and checks the log grew by `n` at the end with every earlier line unchanged. */
const grows = (args: string[], n: number) => {
  const before = lines()
  const r = p.werk(args)
  const after = lines()
  expect(after.length).toBe(before.length + n)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
const GHOST = /ghost/
const isGhost = (out: string) => /state: ghost/.test(out)
const isReal = (out: string) => /state: real/.test(out) && !GHOST.test(out)

test('62.1 an agent proposes a card and the person accepts it', () => {
  p = makeProject()
  ok(['add', 'seed', '--title', 'Seed card'])
  ok(['accept', 'seed', '--actor', 'you'])
  ok(['add', 'seed2', '--title', 'Another'])
  const add = grows(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'Because history'], 1)
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')
  const s1 = ok(['show', 'c1']).stdout
  expect(s1).toContain('Use a log')
  expect(s1).toContain('The body text')
  expect(s1).toContain('Because history')
  expect(isGhost(s1)).toBe(true)
  const acc = grows(['accept', 'c1', '--actor', 'you'], 1)
  expect(acc.code).toBe(0)
  const s2 = ok(['show', 'c1']).stdout
  expect(s2).toContain('Use a log')
  expect(s2).toContain('The body text')
  expect(s2).toContain('Because history')
  expect(isReal(s2)).toBe(true)
})

test('62.2 accept without the claim refuses and leaves the ghost', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  const r = grows(['accept', 'c1'], 0)
  expect(r.code).not.toBe(0)
  expect(isGhost(ok(['show', 'c1']).stdout)).toBe(true)
  ok(['accept', 'c1', '--actor', 'you'])
  expect(isReal(ok(['show', 'c1']).stdout)).toBe(true)
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  expect(grows(['edit', 'c1', '--body', 'new body'], 0).code).not.toBe(0)
  expect(grows(['retitle', 'c1', '--title', 'Use an append-only log'], 0).code).not.toBe(0)
  expect(grows(['add', 'c1', '--title', 'Something else'], 0).code).not.toBe(0)
  const s = ok(['show', 'c1']).stdout
  expect(s).toContain('Use a log')
  expect(isGhost(s)).toBe(true)
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  ok(['accept', 'c1', '--actor', 'you'])
  const before = lines()
  const r = grows(['retitle', 'c1', '--title', 'Use an append-only log'], 1)
  expect(r.code).toBe(0)
  const s = ok(['show', 'c1']).stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const idx = before.findIndex((l) => l.includes('"Use a log"'))
  expect(idx).toBeGreaterThanOrEqual(0)
  expect(lines()[idx]).toBe(before[idx]!)
  ok(['edit', 'c1', '--body', 'A fresh body'])
  const s2 = ok(['show', 'c1']).stdout
  expect(s2).toContain('A fresh body')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  ok(['add', 'c1', '--title', 'Use a log'])
  ok(['accept', 'c1', '--actor', 'you'])
  const adds: [string, string[], string[]][] = [
    ['o1', ['--kind', 'option', '--title', 'Use a database', '--parent', 'c1', '--why-not', 'Too heavy'], ['Use a database', 'Too heavy']],
    ['s1', ['--kind', 'source', '--title', 'Kleppmann book', '--who', 'Martin'], ['Kleppmann book', 'Martin']],
    ['e1', ['--kind', 'excerpt', '--title', 'Logs are truth', '--body', 'The log is the truth.'], ['Logs are truth', 'The log is the truth.']],
  ]
  for (const [id, flags, shown] of adds) {
    const r = grows(['add', id, ...flags], 1)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    const s = ok(['show', id]).stdout
    for (const f of shown) expect(s).toContain(f)
    expect(isGhost(s)).toBe(true)
  }
  ok(['accept', 'o1', '--actor', 'you'])
  const o = ok(['show', 'o1']).stdout
  expect(isReal(o)).toBe(true)
  expect(o).toContain('why-not: Too heavy')
  expect(isGhost(ok(['show', 's1']).stdout)).toBe(true)
  expect(isGhost(ok(['show', 'e1']).stdout)).toBe(true)
})
