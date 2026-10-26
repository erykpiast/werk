import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

// Each step runs many werk commands, and a busy machine runs them slowly.
setDefaultTimeout(120_000)

const logLines = (p: Project) => {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const show = (p: Project, id: string) => p.werk(['show', id]).stdout
const GHOST = 'state: ghost'
const REAL = 'state: real'

// Scenario: An agent proposes a card and a person accepts it into the map
test('62.1 an agent proposes a card and a person accepts it', () => {
  const p = makeProject()
  // Given a map whose log already holds some events
  ok(p, ['add', 'root', '--title', 'Root card'])
  ok(p, ['accept', 'root', '--actor', 'you'])
  const before = logLines(p)
  expect(before.length).toBeGreaterThan(0)
  // When the agent adds a new card with an id, a title, a body and a why from the command line
  const add = p.werk(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.code).toBe(0)
  // Then the command output says "proposed"
  expect(add.stdout).toContain('proposed')
  // And the log has exactly one more event, at the end, and every earlier line is unchanged
  const after1 = logLines(p)
  expect(after1.length).toBe(before.length + 1)
  expect(after1.slice(0, before.length)).toEqual(before)
  // When the person shows that card from the command line
  const s1 = show(p, 'c1')
  // Then the output prints its title, body and why, and marks the card as a ghost
  for (const t of ['Use a log', 'The body text', 'The why text']) expect(s1).toContain(t)
  expect(s1).toContain(GHOST)
  // When the agent accepts the card and states that the person asked for it
  const acc = p.werk(['accept', 'c1', '--actor', 'you'])
  // Then the command succeeds
  expect(acc.code).toBe(0)
  // And the log has exactly one more event, at the end, and every earlier line is unchanged
  const after2 = logLines(p)
  expect(after2.length).toBe(after1.length + 1)
  expect(after2.slice(0, after1.length)).toEqual(after1)
  // And showing the card prints the same title, body and why, and marks the card as real, not as a ghost
  const s2 = show(p, 'c1')
  for (const t of ['Use a log', 'The body text', 'The why text']) expect(s2).toContain(t)
  expect(s2).toContain(REAL)
  expect(s2).not.toContain(GHOST)
})

// Scenario: An accept without the person's claim refuses and leaves the ghost waiting
test("62.2 an accept without the person's claim refuses", () => {
  const p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  const before = logLines(p)
  const r = p.werk(['accept', 'c1'])
  expect(r.code).not.toBe(0)
  expect(logLines(p)).toEqual(before)
  expect(show(p, 'c1')).toContain(GHOST)
  ok(p, ['accept', 'c1', '--actor', 'you'])
  expect(show(p, 'c1')).toContain(REAL)
})

// Scenario: The words of a ghost are frozen
test('62.3 the words of a ghost are frozen', () => {
  const p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  let n = logLines(p).length
  const e = p.werk(['edit', 'c1', '--body', 'new body'])
  expect(e.code).not.toBe(0)
  expect(logLines(p).length).toBe(n)
  const rt = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(rt.code).not.toBe(0)
  expect(logLines(p).length).toBe(n)
  const a = p.werk(['add', 'c1', '--title', 'Another title'])
  expect(a.code).not.toBe(0)
  expect(logLines(p).length).toBe(n)
  const s = show(p, 'c1')
  expect(s).toContain('Use a log')
  expect(s).not.toContain('Another title')
  expect(s).toContain(GHOST)
})

// Scenario: A retitle on a real card shows only the new title and keeps the old one in the log
test('62.4 a retitle on a real card keeps the old title in the log', () => {
  const p = makeProject()
  ok(p, ['add', 'c1', '--title', 'Use a log'])
  ok(p, ['accept', 'c1', '--actor', 'you'])
  const before = logLines(p)
  const rt = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  expect(rt.code).toBe(0)
  const after = logLines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  const s = show(p, 'c1')
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log\n')
  expect(s.split('\n').some((l) => /Use a log$/.test(l))).toBe(false)
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true)
  expect(after.some((l) => l.includes('"Use a log"'))).toBe(true)
  ok(p, ['edit', 'c1', '--body', 'A brand new body'])
  const s2 = show(p, 'c1')
  expect(s2).toContain('A brand new body')
  expect(s2).toContain('Use an append-only log')
})

// Scenario: An option, a source and an excerpt also enter as ghosts
test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  const p = makeProject()
  ok(p, ['add', 'card', '--title', 'Real card'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'Benchmark notes']],
    ['exc', ['add', 'exc', '--kind', 'excerpt', '--title', 'A quoted line']],
  ]
  for (const [, args] of adds) {
    const before = logLines(p)
    const r = p.werk(args)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
    const after = logLines(p)
    expect(after.length).toBe(before.length + 1)
    expect(after.slice(0, before.length)).toEqual(before)
  }
  const so = show(p, 'opt')
  expect(so).toContain('Use Postgres')
  expect(so).toContain('Too heavy')
  expect(so).toContain(GHOST)
  expect(show(p, 'src')).toContain('Benchmark notes')
  expect(show(p, 'src')).toContain(GHOST)
  expect(show(p, 'exc')).toContain('A quoted line')
  expect(show(p, 'exc')).toContain(GHOST)
  ok(p, ['accept', 'opt', '--actor', 'you'])
  const so2 = show(p, 'opt')
  expect(so2).toContain(REAL)
  expect(so2).toContain('why-not: Too heavy')
  expect(show(p, 'src')).toContain(GHOST)
  expect(show(p, 'exc')).toContain(GHOST)
})
