/** Held-out steps of ticket 64: the decide contract check and its fix commands. */
import { expect, test } from 'bun:test'
import { events, project, refuses, type P } from './helpers.ts'

/** The printed fix commands: each indented line that starts with `werk `. */
const commands = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

const statusEvents = (p: P, id: string) => events(p).filter((e) => e.type === 'node.status_set' && e.payload.id === id)

/** An open real card with a decider, a depends_on edge to a decided card, and a rejected option. */
function cardWithoutKill(p: P) {
  p.decided('base', 'Base')
  p.real('choice', 'Pick a store', ['--body', 'We pick one store.'])
  p.ok('edit', 'choice', '--who', 'you')
  p.ok('link', 'choice', 'base', '--type', 'depends_on')
  p.ok('add', 'choice-alt', '--kind', 'option', '--title', 'Keep files', '--why-not', 'No history')
  p.ok('accept', 'choice-alt', '--actor', 'you')
  p.ok('link', 'choice-alt', 'choice', '--type', 'alternative_to')
}

test('64.1 A card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const p = project()
  cardWithoutKill(p)
  const before = statusEvents(p, 'choice').length
  const r = refuses(p, 'status', 'choice', 'decided')
  const out = r.stdout + r.stderr
  expect(out).toContain('kill')
  const cmds = commands(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toStartWith('werk kill choice')
  expect(p.show('choice')).toContain('status: open')
  expect(statusEvents(p, 'choice')).toHaveLength(before)
  const fix = p.sh(cmds[0]!)
  expect(fix.code).toBe(0)
  p.ok('status', 'choice', 'decided')
  expect(p.show('choice')).toContain('status: decided')
})

test('64.2 A card that lacks several facts reports each missing fact with its own command', () => {
  const p = project()
  p.decided('base', 'Base')
  p.real('bare', 'A bare card', ['--body', 'Only words.'])
  const r = refuses(p, 'status', 'bare', 'decided')
  const out = r.stdout + r.stderr
  expect(out).toContain('who:')
  expect(out).toContain('depends_on')
  expect(out).toContain('option')
  expect(out).toContain('kill')
  const cmds = commands(out)
  expect(cmds).toHaveLength(4)
  expect(p.show('bare')).toContain('status: open')
  for (const c of cmds) {
    // The agent fills the placeholder of the card it needs with a real card.
    const fix = p.sh(c.replace('<card-it-needs>', 'base'))
    expect(fix.code).toBe(0)
  }
  p.ok('status', 'bare', 'decided')
  expect(p.show('bare')).toContain('status: decided')
})

test('64.3 A ghost card obeys the same check through its held edges', () => {
  const p = project()
  p.decided('base', 'Base')
  for (const id of ['g1', 'g2']) {
    p.ok('add', id, '--title', `Ghost ${id}`, '--who', 'you')
    p.ok('add', `${id}-opt`, '--kind', 'option', '--title', 'Other way', '--why-not', 'Worse')
    p.ok('link', `${id}-opt`, id, '--type', 'alternative_to')
    p.ok('kill', id, '--form', 'manual', '--text', 'Check it by use')
  }
  p.ok('link', 'g1', 'base', '--type', 'depends_on')
  const r1 = p.w('status', 'g1', 'decided')
  expect(r1.code).toBe(0)
  expect(p.show('g1')).toContain('status: decided')
  const r2 = refuses(p, 'status', 'g2', 'decided')
  const out = r2.stdout + r2.stderr
  expect(out).toContain('depends_on')
  expect(commands(out).some((c) => c.startsWith('werk link g2') && c.includes('--type depends_on'))).toBe(true)
  expect(p.show('g2')).not.toContain('status: decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option, and a kill criterion. */
function decidedFull(p: P) {
  p.decided('base', 'Base')
  p.real('choice', 'Pick a store', ['--body', 'We pick one store, and it holds every change.'])
  p.ok('edit', 'choice', '--who', 'you')
  p.ok('link', 'choice', 'base', '--type', 'depends_on')
  p.ok('add', 'choice-alt', '--kind', 'option', '--title', 'Keep files', '--why-not', 'No history')
  p.ok('accept', 'choice-alt', '--actor', 'you')
  p.ok('link', 'choice-alt', 'choice', '--type', 'alternative_to')
  p.ok('kill', 'choice', '--form', 'revisit')
  p.ok('status', 'choice', 'decided')
}

test('64.4 An amend that removes a required fact is refused and the decided card stays the same', () => {
  const p = project()
  decidedFull(p)
  const before = p.show('choice')
  const r = refuses(p, 'amend', 'choice', '--unlink', 'base', '--summary', 'Drop the base')
  const out = r.stdout + r.stderr
  expect(out).toContain('depends_on')
  expect(commands(out).some((c) => c.startsWith('werk link choice') && c.includes('--type depends_on'))).toBe(true)
  const after = p.show('choice')
  expect(after).toContain('status: decided')
  expect(after).toBe(before)
})

test('64.5 An amend that keeps every fact succeeds, and card text is not checked', () => {
  const p = project()
  decidedFull(p)
  const n = p.logLines().length
  const r = p.w('amend', 'choice', '--body', 'One store.', '--summary', 'Shorter body')
  expect(r.code).toBe(0)
  const shown = p.show('choice')
  expect(shown).toContain('status: decided')
  expect(shown).toContain('One store.')
  const added = events(p).slice(n)
  expect(added.some((e) => e.type === 'node.reopened' && e.payload.id === 'choice')).toBe(true)
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'choice', status: 'decided' } })
})
