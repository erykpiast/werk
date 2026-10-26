/** Held-out steps 62.x: ghosts and accept from the command line. */
import { expect, test } from 'bun:test'
import { appendsOne, lines, ok, project, realCard, refusesNoEvent, show } from './helpers.ts'

test('62.1 an agent proposes a card and a person accepts it into the map', () => {
  const p = project()
  realCard(p, 'root', 'The root')
  ok(p, ['say', 'root', '--text', 'an earlier note'])
  expect(lines(p).length).toBeGreaterThan(0)

  const add = appendsOne(p, ['add', 'log', '--title', 'Use a log', '--body', 'One line per change.', '--why', 'It keeps history.'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')

  const ghost = show(p, 'log')
  expect(ghost.code).toBe(0)
  expect(ghost.stdout).toContain('Use a log')
  expect(ghost.stdout).toContain('One line per change.')
  expect(ghost.stdout).toContain('It keeps history.')
  expect(ghost.stdout).toContain('ghost')

  const acc = appendsOne(p, ['accept', 'log', '--actor', 'you'])
  expect(acc.code).toBe(0)
  const real = show(p, 'log').stdout
  expect(real).toContain('Use a log')
  expect(real).toContain('One line per change.')
  expect(real).toContain('It keeps history.')
  expect(real).toContain('state: real')
  expect(real).not.toContain('ghost')
})

test('62.2 an accept without the person claim refuses and leaves the ghost waiting', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  refusesNoEvent(p, ['accept', 'log'])
  expect(show(p, 'log').stdout).toContain('ghost')
  ok(p, ['accept', 'log', '--actor', 'you'])
  expect(show(p, 'log').stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  refusesNoEvent(p, ['edit', 'log', '--body', 'A new body'])
  refusesNoEvent(p, ['retitle', 'log', '--title', 'Use an append-only log'])
  refusesNoEvent(p, ['add', 'log', '--title', 'Another title'])
  const s = show(p, 'log').stdout
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  const p = project()
  ok(p, ['add', 'log', '--title', 'Use a log'])
  ok(p, ['accept', 'log', '--actor', 'you'])
  const before = lines(p)
  const r = appendsOne(p, ['retitle', 'log', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  const s = show(p, 'log').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  expect(lines(p).slice(0, before.length).some((l) => l.includes('"Use a log"'))).toBe(true)
  ok(p, ['edit', 'log', '--body', 'Each change is a new line.'])
  const s2 = show(p, 'log').stdout
  expect(s2).toContain('Each change is a new line.')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  const p = project()
  realCard(p, 'store', 'Store the map')
  const opt = appendsOne(p, ['add', 'pg', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'It needs a server.'])
  const src = appendsOne(p, ['add', 'notes', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'Numbers from a run.'])
  const exc = appendsOne(p, ['add', 'ex', '--kind', 'excerpt', '--title', 'logs are simple', '--body', 'A quoted line.'])
  ok(p, ['link', 'pg', 'store', '--type', 'alternative_to'])
  for (const r of [opt, src, exc]) {
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('proposed')
  }
  const so = show(p, 'pg').stdout
  expect(so).toContain('Use Postgres')
  expect(so).toContain('It needs a server.')
  expect(so).toContain('kind: option')
  expect(so).toContain('ghost')
  const ss = show(p, 'notes').stdout
  expect(ss).toContain('Benchmark notes')
  expect(ss).toContain('Numbers from a run.')
  expect(ss).toContain('ghost')
  const se = show(p, 'ex').stdout
  expect(se).toContain('logs are simple')
  expect(se).toContain('A quoted line.')
  expect(se).toContain('ghost')

  ok(p, ['accept', 'pg', '--actor', 'you'])
  const so2 = show(p, 'pg').stdout
  expect(so2).toContain('state: real')
  expect(so2).toContain('why-not: It needs a server.')
  expect(show(p, 'notes').stdout).toContain('ghost')
  expect(show(p, 'ex').stdout).toContain('ghost')
})
