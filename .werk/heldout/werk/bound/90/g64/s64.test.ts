/** Held-out steps 64.1–64.5: the contract check at decide and amend. */
import { afterEach, expect, test } from 'bun:test'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { events, lines, mapStatus, ok, printedCommands, runPrinted } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** A decided real card `base` that other cards can depend on. */
const decidedBase = () => {
  ok(p, ['add', 'base', '--title', 'Base', '--who', 'me'])
  ok(p, ['accept', 'base', '--actor', 'you'])
  ok(p, ['edit', 'base', '--no-basis', 'the root of the map'])
  ok(p, ['kill', 'base', '--form', 'revisit'])
  ok(p, ['status', 'base', 'decided'])
}

/** An open real card `a` with a decider, a depends_on edge to base, and a rejected option. */
const weighed = () => {
  decidedBase()
  ok(p, ['add', 'a', '--title', 'A', '--who', 'me', '--body', 'Old words.', '--status', 'open'])
  ok(p, ['accept', 'a', '--actor', 'you'])
  ok(p, ['link', 'a', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(p, ['add', 'a:opt0', '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(p, ['link', 'a:opt0', 'a', '--type', 'alternative_to'])
  ok(p, ['accept', 'a:opt0', '--actor', 'you'])
}

const statusEventsOf = (id: string) => events(p).filter((e) => e.payload.id === id && e.type === 'node.status_set')

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  weighed()
  expect(mapStatus(p, 'a')).toBe('open')
  const before = lines(p)
  const statusBefore = statusEventsOf('a').length

  const r = p.werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(1)
  expect(cmds[0]).toMatch(/^werk kill a /)
  expect(mapStatus(p, 'a')).toBe('open')
  expect(lines(p)).toEqual(before)
  expect(statusEventsOf('a').length).toBe(statusBefore)

  runPrinted(p, cmds[0]!)
  ok(p, ['status', 'a', 'decided'])
  expect(mapStatus(p, 'a')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  decidedBase()
  ok(p, ['add', 'a', '--title', 'A', '--body', 'Some words.', '--status', 'open'])
  ok(p, ['accept', 'a', '--actor', 'you'])

  const r = p.werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/who|decider/)
  expect(out).toContain('depends_on')
  expect(out).toMatch(/option/)
  expect(out).toMatch(/kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(4)
  expect(mapStatus(p, 'a')).toBe('open')

  // The agent fills each placeholder that names a card with a real card of the map.
  for (const c of cmds) runPrinted(p, c.replace('<card-it-needs>', 'base'))
  ok(p, ['status', 'a', 'decided'])
  expect(mapStatus(p, 'a')).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  decidedBase()
  // First ghost: held edges give decider, depends_on, rejected option and kill.
  ok(p, ['add', 'g1', '--title', 'G1', '--who', 'me'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(p, ['add', 'g1:opt0', '--kind', 'option', '--title', 'Other', '--why-not', 'too slow'])
  ok(p, ['link', 'g1:opt0', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'manual', '--text', 'use it for a week'])
  // Second ghost: no depends_on basis.
  ok(p, ['add', 'g2', '--title', 'G2', '--who', 'me'])
  ok(p, ['add', 'g2:opt0', '--kind', 'option', '--title', 'Other', '--why-not', 'too slow'])
  ok(p, ['link', 'g2:opt0', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'use it for a week'])

  ok(p, ['status', 'g1', 'decided'])
  const shown1 = ok(p, ['show', 'g1']).stdout
  expect(shown1).toContain('state: ghost')
  expect(shown1).toContain('status: decided')

  const r = p.werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('depends_on')
  expect(printedCommands(out).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on'))).toBe(true)
  expect(ok(p, ['show', 'g2']).stdout).not.toContain('status: decided')
})

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  weighed()
  ok(p, ['kill', 'a', '--form', 'revisit'])
  ok(p, ['status', 'a', 'decided'])
  const shownBefore = ok(p, ['show', 'a']).stdout
  const before = lines(p)

  const r = p.werk(['amend', 'a', '--unlink', 'base', '--summary', 'a no longer takes the base'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('depends_on')
  expect(printedCommands(out).some((c) => c.startsWith('werk link a ') && c.includes('depends_on'))).toBe(true)
  expect(mapStatus(p, 'a')).toBe('decided')
  expect(ok(p, ['show', 'a']).stdout).toBe(shownBefore)
  expect(lines(p)).toEqual(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  weighed()
  ok(p, ['kill', 'a', '--form', 'revisit'])
  ok(p, ['status', 'a', 'decided'])
  const n = events(p).length

  ok(p, ['amend', 'a', '--body', 'Short.', '--summary', 'a says it shorter'])
  expect(mapStatus(p, 'a')).toBe('decided')
  const shown = ok(p, ['show', 'a']).stdout
  expect(shown).toContain('status: decided')
  expect(shown).toContain('Short.')
  const types = events(p).slice(n).filter((e) => e.payload.id === 'a').map((e) => e.type)
  expect(types).toContain('node.reopened')
  expect(types.indexOf('node.status_set')).toBeGreaterThan(types.indexOf('node.reopened'))
})
