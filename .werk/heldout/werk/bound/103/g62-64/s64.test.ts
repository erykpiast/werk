import { expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { decidedReal, project, type Ctx } from './helpers.ts'

const statusEvents = (c: Ctx, id: string) => c.log().map((l) => JSON.parse(l)).filter((e) => e.type === 'node.status_set' && e.payload.id === id)
/** The printed fix commands: the indented lines that start with `werk`. */
const commands = (out: string) => out.split('\n').filter((l) => /^ {4}werk /.test(l)).map((l) => l.trim())

/** A card with a decider, a depends_on edge to a decided card, and a rejected option. */
function almost(c: Ctx, id: string) {
  decidedReal(c, 'base', 'The base decision')
  c.ok(['add', id, '--title', 'Use a log', '--body', 'Every change is an event.', '--who', 'you'])
  c.ok(['accept', id, '--actor', 'you'])
  c.ok(['link', id, 'base', '--type', 'depends_on', '--why', 'needs the base'])
  c.ok(['add', 'opt', '--kind', 'option', '--title', 'Use a table', '--why-not', 'Rows are overwritten'])
  c.ok(['link', 'opt', id, '--type', 'alternative_to'])
  c.ok(['accept', 'opt', '--actor', 'you'])
}

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const c = project()
  almost(c, 'card')
  const before = statusEvents(c, 'card').length
  const r = c.refuses(['status', 'card', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill criterion/)
  expect(out).not.toMatch(/^\s*(who|basis|options):/m)
  const cmds = commands(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toMatch(/^werk kill card /)
  expect(c.show('card')).toContain('status: open')
  expect(statusEvents(c, 'card')).toHaveLength(before)
  expect(c.sh(cmds[0]!).code).toBe(0)
  expect(c.werk(['status', 'card', 'decided']).code).toBe(0)
  expect(c.show('card')).toContain('status: decided')
})

test('64.2 a card that lacks several facts reports each with its own command', () => {
  const c = project()
  decidedReal(c, 'base', 'The base decision')
  c.ok(['add', 'bare', '--title', 'A bare card', '--body', 'Only words.'])
  c.ok(['accept', 'bare', '--actor', 'you'])
  const r = c.refuses(['status', 'bare', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s*who:/m)
  expect(out).toMatch(/depends_on/)
  expect(out).toMatch(/^\s*options:.*option/m)
  expect(out).toMatch(/kill criterion/)
  const cmds = commands(out)
  expect(cmds.length).toBe(4)
  expect(c.show('bare')).toContain('status: open')
  for (const cmd of cmds) {
    // The basis command names a placeholder card; the agent fills in the card it needs.
    const filled = cmd.replace('<card-it-needs>', 'base')
    const res = c.sh(filled)
    expect(res.code).toBe(0)
  }
  const again = c.werk(['status', 'bare', 'decided'])
  expect(again.code).toBe(0)
  expect(c.show('bare')).toContain('status: decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  const c = project()
  decidedReal(c, 'base', 'The base decision')
  c.ok(['add', 'g1', '--title', 'First ghost', '--who', 'you'])
  c.ok(['link', 'g1', 'base', '--type', 'depends_on'])
  c.ok(['add', 'o1', '--kind', 'option', '--title', 'Other way', '--why-not', 'slower'])
  c.ok(['link', 'o1', 'g1', '--type', 'alternative_to'])
  c.ok(['kill', 'g1', '--form', 'manual', '--text', 'revisit'])
  c.ok(['add', 'g2', '--title', 'Second ghost', '--who', 'you'])
  c.ok(['add', 'o2', '--kind', 'option', '--title', 'Another way', '--why-not', 'costly'])
  c.ok(['link', 'o2', 'g2', '--type', 'alternative_to'])
  c.ok(['kill', 'g2', '--form', 'manual', '--text', 'revisit'])
  expect(c.show('g1')).toContain('(held)')
  expect(c.werk(['status', 'g1', 'decided']).code).toBe(0)
  const s1 = c.show('g1')
  expect(s1).toContain('status: decided')
  expect(s1).toMatch(/state: ghost/)
  const r = c.refuses(['status', 'g2', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s*basis:.*depends_on/m)
  expect(commands(out).some((l) => l.startsWith('werk link g2 ') && l.includes('depends_on'))).toBe(true)
  expect(c.show('g2')).not.toContain('status: decided')
})

function decided(c: Ctx) {
  almost(c, 'card')
  c.ok(['kill', 'card', '--form', 'manual', '--text', 'revisit by use'])
  c.ok(['status', 'card', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the card stays the same', () => {
  const c = project()
  decided(c)
  const before = c.show('card')
  const r = c.refuses(['amend', 'card', '--unlink', 'base', '--summary', 'drop the base'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s*basis:.*depends_on/m)
  expect(commands(out).some((l) => l.startsWith('werk link card ') && l.includes('depends_on'))).toBe(true)
  const after = c.show('card')
  expect(after).toContain('status: decided')
  expect(after).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  const c = project()
  decided(c)
  const n = c.log().length
  const r = c.werk(['amend', 'card', '--body', 'Short.', '--summary', 'tighten the body'])
  expect(r.code).toBe(0)
  const s = c.show('card')
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  expect(s).not.toContain('Every change is an event.')
  const added = c.log().slice(n).map((l) => JSON.parse(l))
  expect(added.find((e) => e.type === 'node.reopened' && e.payload.id === 'card')).toBeDefined()
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'card', status: 'decided' } })
})
