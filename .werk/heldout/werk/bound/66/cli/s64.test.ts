import { afterEach, expect, test } from 'bun:test'
import { ok, project, type P } from '../lib.ts'
import { accepted, killed, linked, noBasis, proposed, whoSet } from '../../src/test/map-events.ts'

let p: P
afterEach(() => p?.cleanup())

/** A real decided card "base" that holds every fact, for other cards to depend on. */
const base = () => [proposed('base', { title: 'Base', status: 'decided', who: 'me' }), noBasis('base', 'the root'), killed('base'), accepted('base')]

const statusOf = (id: string) => ok(p.w('show', id)).stdout.split('\n').find((l) => l.startsWith('status:'))
const statusEvents = (id: string) => p.events().filter((e) => e.type === 'node.status_set' && e.payload.id === id).length

/** The printed fix commands: each indented line that starts with "werk ". */
const commandsIn = (text: string) => text.split('\n').filter((l) => /^\s+werk /.test(l)).map((l) => l.trim())

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = project()
  p.seed(
    ...base(),
    proposed('card', { title: 'Use a log', status: 'open', who: 'you' }),
    accepted('card'),
    linked('card', 'base', 'depends_on'),
    proposed('db', { kind: 'option', title: 'Use a database', whyNot: 'Too heavy' }),
    accepted('db'),
    linked('db', 'card', 'alternative_to'),
  )
  const before = statusEvents('card')
  const r = p.w('status', 'card', 'decided')
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/)
  const cmds = commandsIn(out)
  expect(cmds.length).toBe(1)
  expect(cmds[0]).toStartWith('werk kill card')
  expect(statusOf('card')).toBe('status: open')
  expect(statusEvents('card')).toBe(before)

  expect(p.sh(cmds[0]!).code).toBe(0)
  expect(p.w('status', 'card', 'decided').code).toBe(0)
  expect(statusOf('card')).toBe('status: decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = project()
  p.seed(...base(), proposed('card', { title: 'Use a log', body: 'The map is a log.', status: 'open' }), accepted('card'))
  const r = p.w('status', 'card', 'decided')
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  const facts = out.split('\n').filter((l) => /^\s+\w+:/.test(l)).map((l) => l.trim().split(':')[0])
  expect({ facts, cmds: commandsIn(out).length }).toEqual({ facts: ['who', 'basis', 'options', 'kill'], cmds: 4 })
  expect(statusOf('card')).toBe('status: open')

  // The agent fills the placeholder that names the card it needs.
  for (const cmd of commandsIn(out)) expect(p.sh(cmd.replace('<card-it-needs>', 'base')).code).toBe(0)
  expect(p.w('status', 'card', 'decided').code).toBe(0)
  expect(statusOf('card')).toBe('status: decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = project()
  p.seed(...base())
  ok(p.w('add', 'g1', '--title', 'First ghost', '--who', 'you'))
  ok(p.w('link', 'g1', 'base', '--type', 'depends_on'))
  ok(p.w('add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'It lost'))
  ok(p.w('link', 'g1-opt', 'g1', '--type', 'alternative_to'))
  ok(p.w('kill', 'g1', '--form', 'manual', '--text', 'use it for a week'))

  ok(p.w('add', 'g2', '--title', 'Second ghost', '--who', 'you'))
  ok(p.w('add', 'g2-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'It lost'))
  ok(p.w('link', 'g2-opt', 'g2', '--type', 'alternative_to'))
  ok(p.w('kill', 'g2', '--form', 'manual', '--text', 'use it for a week'))

  expect(p.w('status', 'g1', 'decided').code).toBe(0)
  expect(statusOf('g1')).toBe('status: decided')

  const r = p.w('status', 'g2', 'decided')
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('basis')
  expect(out).toContain('depends_on')
  expect(commandsIn(out).some((c) => c.startsWith('werk link g2') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf('g2')).not.toBe('status: decided')
})

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = project()
  p.seed(
    ...base(),
    proposed('card', { title: 'Use a log', body: 'The map is a log.', status: 'decided', who: 'you' }),
    linked('card', 'base', 'depends_on'),
    proposed('db', { kind: 'option', title: 'Use a database', whyNot: 'Too heavy' }),
    linked('db', 'card', 'alternative_to'),
    killed('card'),
    accepted('card'),
    accepted('db'),
  )
  const before = ok(p.w('show', 'card')).stdout
  // No verb takes an edge away. The agent looks for one in help.
  const help = ok(p.w('help')).stdout
  const verbs = help.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]!)
  const remover = verbs.find((v) => /unlink|unlink-edge|delete-link|remove-link|amend/.test(v))
  expect(remover, `no verb removes a depends_on edge; verbs: ${verbs.join(', ')}`).toBeDefined()
  const r = p.w(remover!, 'card', 'base', '--type', 'depends_on')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('depends_on')
  expect(ok(p.w('show', 'card')).stdout).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = project()
  p.seed(
    ...base(),
    proposed('card', { title: 'Use a log', body: 'The map is a log, and a long body follows here.', status: 'decided', who: 'you' }),
    linked('card', 'base', 'depends_on'),
    proposed('db', { kind: 'option', title: 'Use a database', whyNot: 'Too heavy' }),
    linked('db', 'card', 'alternative_to'),
    killed('card'),
    accepted('card'),
    accepted('db'),
  )
  const before = p.events().length
  const r = p.w('edit', 'card', '--body', 'Short.')
  expect(r.code).toBe(0)
  const show = ok(p.w('show', 'card')).stdout
  expect(show).toContain('status: decided')
  expect(show).toContain('Short.')
  const added = p.events().slice(before).map((e) => e.type)
  expect(added).toContain('node.reopened')
  expect(added).toContain('node.status_set')
})
