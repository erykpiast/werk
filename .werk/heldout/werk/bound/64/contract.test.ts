/** Steps 64.x: the contract check on decide and amend. */
import { afterEach, expect, test } from 'bun:test'
import { project, type Proj } from './lib.ts'

let p: Proj
afterEach(() => p?.cleanup())

const show = (id: string) => p.werk(['show', id]).stdout
const statusOf = (id: string) => show(id).split('\n').find((l) => l.startsWith('status:'))

/** A real decided basis card "base". */
const baseEvents = [
  { type: 'node.proposed', payload: { id: 'base', kind: 'card', title: 'Base', who: 'me', noBasis: 'the root' } },
  { type: 'kill.recorded', payload: { id: 'base', criterion: { form: 'revisit' } } },
  { type: 'node.status_set', payload: { id: 'base', status: 'decided' } },
  { type: 'node.accepted', payload: { id: 'base' }, actor: 'you' },
]

/** A real card "c" with a decider, a depends_on edge to base, and a rejected option. */
const cardWithFacts = (status: string) => [
  ...baseEvents,
  { type: 'node.proposed', payload: { id: 'c', kind: 'card', title: 'Use a log', body: 'The old long body text.', status: 'open', who: 'you' } },
  { type: 'node.accepted', payload: { id: 'c' }, actor: 'you' },
  { type: 'edge.linked', payload: { from: 'c', to: 'base', type: 'depends_on' } },
  { type: 'node.proposed', payload: { id: 'opt', kind: 'option', title: 'Use a table', whyNot: 'A table is rewritten' } },
  { type: 'node.accepted', payload: { id: 'opt' }, actor: 'you' },
  { type: 'edge.linked', payload: { from: 'opt', to: 'c', type: 'alternative_to' } },
  ...(status === 'decided'
    ? [
        { type: 'kill.recorded', payload: { id: 'c', criterion: { form: 'revisit' } } },
        { type: 'node.status_set', payload: { id: 'c', status: 'decided' } },
      ]
    : []),
]

/** The printed fix commands: the lines that start with "werk ". */
const commandsIn = (out: string) => out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('werk ') && !/^werk [\w-]+:/.test(l))

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = project()
  p.writeLog(cardWithFacts('open'))
  const before = p.logLines()
  const r = p.werk(['status', 'c', 'decided'])
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/kill criterion/)
  const cmds = commandsIn(r.out)
  const killCmd = cmds.find((c) => c.startsWith('werk kill c '))
  expect(killCmd).toBeDefined()
  expect(statusOf('c')).toBe('status: open')
  expect(p.logLines()).toEqual(before)
  const fix = p.sh(killCmd!)
  expect(fix.code).toBe(0)
  const again = p.werk(['status', 'c', 'decided'])
  expect(again.code).toBe(0)
  expect(statusOf('c')).toBe('status: decided')
})

test('64.2 a card that lacks several facts reports each with its own command', () => {
  p = project()
  p.writeLog([
    ...baseEvents,
    { type: 'node.proposed', payload: { id: 'c', kind: 'card', title: 'Bare card', body: 'Only body text.', status: 'open' } },
    { type: 'node.accepted', payload: { id: 'c' }, actor: 'you' },
  ])
  const r = p.werk(['status', 'c', 'decided'])
  const problems: string[] = []
  if (r.code === 0) problems.push('the decide succeeded')
  const out = r.out
  if (!/^\s*who:/m.test(out)) problems.push('no missing decider (who) named')
  if (!/^\s*basis:/m.test(out) || !out.includes('depends_on')) problems.push('no missing depends_on basis named')
  if (!/^\s*options:/m.test(out)) problems.push('no missing rejected option named')
  if (!/^\s*kill:/m.test(out)) problems.push('no missing kill criterion named')
  const cmds = commandsIn(out)
  if (cmds.length < 4) problems.push(`only ${cmds.length} fix commands printed: ${JSON.stringify(cmds)}`)
  if (statusOf('c') !== 'status: open') problems.push(`status after refusal: ${statusOf('c')}`)
  // The agent runs each printed command, with its placeholder for the needed card filled in.
  for (const cmd of cmds) {
    const filled = cmd.replace('<card-it-needs>', 'base')
    const res = p.sh(filled)
    if (res.code !== 0) problems.push(`printed command failed: ${filled}: ${res.stderr.trim()}`)
  }
  const again = p.werk(['status', 'c', 'decided'])
  if (again.code !== 0) problems.push(`decide after fixes failed: ${again.stderr.trim()}`)
  if (statusOf('c') !== 'status: decided') problems.push(`final status: ${statusOf('c')}`)
  expect({ out, problems }).toEqual({ out, problems: [] })
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = project()
  p.writeLog(baseEvents)
  const ok = (args: string[]) => expect(p.werk(args).code).toBe(0)
  ok(['add', 'g1', '--title', 'Ghost one'])
  ok(['edit', 'g1', '--who', 'you'])
  ok(['link', 'g1', 'base', '--type', 'depends_on'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'Too slow'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'revisit'])
  ok(['add', 'g2', '--title', 'Ghost two'])
  ok(['edit', 'g2', '--who', 'you'])
  ok(['add', 'g2-opt', '--kind', 'option', '--title', 'Other way two', '--why-not', 'Too slow'])
  ok(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'revisit'])

  const one = p.werk(['status', 'g1', 'decided'])
  expect(one.code).toBe(0)
  expect(show('g1')).toContain('state: ghost')
  expect(statusOf('g1')).toBe('status: decided')

  const two = p.werk(['status', 'g2', 'decided'])
  expect(two.code).not.toBe(0)
  expect(two.out).toMatch(/basis/)
  expect(two.out).toContain('depends_on')
  expect(commandsIn(two.out).some((c) => c.startsWith('werk link g2 ') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf('g2')).not.toBe('status: decided')
})

test('64.4 an amend that removes the depends_on edge is refused and the card stays the same', () => {
  p = project()
  p.writeLog(cardWithFacts('decided'))
  const before = show('c')
  const lines = p.logLines()
  // No verb removes an edge. Look for one in help: unlink / amend / remove.
  const help = p.werk(['help']).stdout
  const verb = help.split('\n').map((l) => l.trim().split(/\s+/)[0]).find((v) => /^(unlink|amend|remove|drop|relink)/.test(v ?? ''))
  expect(verb, `werk help lists no verb that removes an edge:\n${help}`).toBeDefined()
  const r = p.werk([verb!, 'c', 'base', '--type', 'depends_on'])
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/basis/)
  expect(statusOf('c')).toBe('status: decided')
  expect(show('c')).toBe(before)
  expect(p.logLines()).toEqual(lines)
})

test('64.5 an amend that keeps every fact succeeds, and the log shows a reopen and a decide', () => {
  p = project()
  p.writeLog(cardWithFacts('decided'))
  const n = p.logLines().length
  const r = p.werk(['edit', 'c', '--body', 'Keep it short.'])
  expect(r.code).toBe(0)
  expect(statusOf('c')).toBe('status: decided')
  expect(show('c')).toContain('Keep it short.')
  const added = p.events().slice(n)
  const types = added.map((e) => `${e.type}${e.payload?.status ? ':' + e.payload.status : ''}`)
  const reopen = added.some((e) => (e.type === 'node.status_set' && e.payload.status === 'open') || /reopen/.test(e.type))
  const decide = added.some((e) => (e.type === 'node.status_set' && e.payload.status === 'decided') || /amend/.test(e.type))
  expect({ types, reopen, decide }).toEqual({ types, reopen: true, decide: true })
})
