import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

const statusOf = (id: string) => c.show(id).stdout.split('\n').find((l) => l.startsWith('status:'))
/** The command lines a refusal prints: the indented lines that start with `werk `. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  c = newCtx()
  c.decided('base', 'The basis')
  c.real('card', 'The card', { status: 'open' })
  c.ok('edit', 'card', '--who', 'you')
  c.ok('link', 'card', 'base', '--type', 'depends_on')
  c.ok('add', 'opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'Too slow')
  c.ok('link', 'opt', 'card', '--type', 'alternative_to')
  c.ok('accept', 'opt', '--actor', 'you')

  const r = c.refuses('status', 'card', 'decided')
  const out = r.stdout + r.stderr
  expect(out).toContain('kill')
  expect(out).not.toMatch(/\bwho:/)
  const cmds = printedCommands(out)
  const fix = cmds.find((l) => l.startsWith('werk kill card'))
  expect(fix).toBeDefined()
  expect(statusOf('card')).toBe('status: open')

  const run = c.sh(fix!)
  expect(run.code).toBe(0)
  expect(c.w('status', 'card', 'decided').code).toBe(0)
  expect(statusOf('card')).toBe('status: decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  c = newCtx()
  c.decided('base', 'The basis')
  c.real('card', 'The card', { status: 'open', body: 'Only words here.' })

  const r = c.refuses('status', 'card', 'decided')
  const out = r.stdout + r.stderr
  for (const fact of ['who:', 'basis:', 'options:', 'kill:']) expect(out).toContain(fact)
  expect(out).toContain('depends_on')
  const cmds = printedCommands(out)
  expect(cmds.length).toBeGreaterThanOrEqual(4)
  expect(statusOf('card')).toBe('status: open')

  for (const cmd of cmds) {
    // The agent fills the placeholder that names a card with a real card id.
    const filled = cmd.replace('<card-it-needs>', 'base')
    const run = c.sh(filled)
    expect({ cmd: filled, code: run.code, err: run.stderr }).toMatchObject({ code: 0 })
  }
  expect(c.w('status', 'card', 'decided').code).toBe(0)
  expect(statusOf('card')).toBe('status: decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  c = newCtx()
  c.decided('base', 'The basis')
  for (const g of ['g1', 'g2']) {
    c.ok('add', g, '--title', `Ghost ${g}`)
    c.ok('edit', g, '--who', 'you')
    c.ok('add', `${g}-opt`, '--kind', 'option', '--title', `Option for ${g}`, '--why-not', 'lost')
    c.ok('link', `${g}-opt`, g, '--type', 'alternative_to')
    c.ok('kill', g, '--form', 'manual', '--text', 'check by use')
  }
  c.ok('link', 'g1', 'base', '--type', 'depends_on')

  expect(c.w('status', 'g1', 'decided').code).toBe(0)
  const s1 = c.show('g1').stdout
  expect(s1).toContain('status: decided')
  expect(s1).toContain('ghost')

  const r = c.refuses('status', 'g2', 'decided')
  const out = r.stdout + r.stderr
  expect(out).toContain('basis')
  expect(printedCommands(out).some((l) => l.startsWith('werk link g2') && l.includes('depends_on'))).toBe(true)
  expect(statusOf('g2')).not.toBe('status: decided')
})

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  c = newCtx()
  c.decided('base', 'The basis')
  c.real('card', 'The card', { body: 'The original body.' })
  c.ok('edit', 'card', '--who', 'you')
  c.ok('link', 'card', 'base', '--type', 'depends_on')
  c.ok('add', 'opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'Too slow')
  c.ok('link', 'opt', 'card', '--type', 'alternative_to')
  c.ok('accept', 'opt', '--actor', 'you')
  c.ok('kill', 'card', '--form', 'revisit')
  c.ok('status', 'card', 'decided')
  const before = c.show('card').stdout

  const r = c.refuses('amend', 'card', '--unlink', 'base', '--summary', 'drop the basis')
  const out = r.stdout + r.stderr
  expect(out).toContain('basis')
  expect(printedCommands(out).some((l) => l.startsWith('werk link card') && l.includes('depends_on'))).toBe(true)
  expect(statusOf('card')).toBe('status: decided')
  expect(c.show('card').stdout).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  c = newCtx()
  c.decided('base', 'The basis')
  c.real('card', 'The card', { body: 'A long original body with many words in it.' })
  c.ok('edit', 'card', '--who', 'you')
  c.ok('link', 'card', 'base', '--type', 'depends_on')
  c.ok('add', 'opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'Too slow')
  c.ok('link', 'opt', 'card', '--type', 'alternative_to')
  c.ok('accept', 'opt', '--actor', 'you')
  c.ok('kill', 'card', '--form', 'revisit')
  c.ok('status', 'card', 'decided')
  const n = c.events().length

  const r = c.w('amend', 'card', '--body', 'Short.', '--summary', 'shorter body')
  expect(r.code).toBe(0)
  const s = c.show('card').stdout
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  const added = c.events().slice(n)
  expect(added.some((e) => e.type === 'node.reopened' && e.payload.id === 'card')).toBe(true)
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'card', status: 'decided' } })
})
