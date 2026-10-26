import { afterEach, expect, test } from 'bun:test'
import { accepted, graphOf, killed, linked, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const statusOnMap = async (id: string) => (await graphOf(p)).nodes.find((n) => n.id === id)?.status
const statusEvents = (id: string) => p.events().filter((e) => e.type === 'node.status_set' && e.payload.id === id)
/** The printed fix commands: the indented lines that start with `werk `. */
const commandsIn = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk ') && !/^werk [\w-]+:/.test(l))

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', async () => {
  p = project()
  p.writeLog([
    proposed('base', { status: 'decided', who: 'me' }),
    proposed('card', { status: 'open', who: 'you' }),
    proposed('rejected', { kind: 'option', title: 'The other way', whyNot: 'slower' }),
    accepted('base'),
    accepted('card'),
    accepted('rejected'),
    linked('card', 'base', 'depends_on'),
    linked('rejected', 'card', 'alternative_to'),
  ])
  const statusBefore = statusEvents('card').length
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('kill')
  const cmds = commandsIn(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]!.startsWith('werk kill card ')).toBe(true)
  expect(await statusOnMap('card')).toBe('open')
  expect(statusEvents('card').length).toBe(statusBefore)
  expect(p.sh(cmds[0]!).code).toBe(0)
  expect(p.werk(['status', 'card', 'decided']).code).toBe(0)
  expect(await statusOnMap('card')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', async () => {
  p = project()
  p.writeLog([
    proposed('base', { status: 'decided', who: 'me' }),
    proposed('card', { status: 'open', body: 'Only a body.' }),
    accepted('base'),
    accepted('card'),
  ])
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  const facts = out.split('\n').map((l) => l.trim().split(':')[0])
  const named = { who: facts.includes('who'), basis: facts.includes('basis'), options: facts.includes('options'), kill: facts.includes('kill') }
  const cmds = commandsIn(out)
  // Keep going to run each printed command, then judge every Then together.
  expect(await statusOnMap('card')).toBe('open')
  const runs = cmds.map((c) => {
    // A placeholder outside quotes names a card the agent picks; the decided card "base" is the one it needs.
    const filled = c.replace('<card-it-needs>', 'base')
    return p.sh(filled).code
  })
  const again = p.werk(['status', 'card', 'decided'])
  const finalStatus = await statusOnMap('card')
  expect({ named, commands: cmds.length, runs, again: again.code, finalStatus, out }).toMatchObject({
    named: { who: true, basis: true, options: true, kill: true },
    commands: 4,
    again: 0,
    finalStatus: 'decided',
  })
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = project()
  p.writeLog([proposed('base', { status: 'decided', who: 'me' }), accepted('base')])
  const ok = (args: string[]) => expect(p.werk(args).code).toBe(0)
  ok(['add', 'g1', '--title', 'First ghost', '--who', 'you'])
  ok(['link', 'g1', 'base', '--type', 'depends_on'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'slower'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'manual', '--text', 'use it a week'])
  ok(['add', 'g2', '--title', 'Second ghost', '--who', 'me'])
  ok(['kill', 'g2', '--form', 'manual', '--text', 'use it a week'])
  const first = p.werk(['status', 'g1', 'decided'])
  expect(first.code).toBe(0)
  expect(p.werk(['show', 'g1']).stdout).toContain('status: decided')
  const second = p.werk(['status', 'g2', 'decided'])
  expect(second.code).not.toBe(0)
  const out = second.stdout + second.stderr
  expect(out).toContain('basis')
  expect(out).toContain('werk link g2 ')
  expect(out).toContain('--type depends_on')
  expect(p.werk(['show', 'g2']).stdout).not.toContain('status: decided')
})

/** A decided real card with all four facts. */
const decidedCard = () => [
  proposed('base', { status: 'decided', who: 'me' }),
  proposed('card', { status: 'open', who: 'you', body: 'A long body that explains the decision in full.' }),
  proposed('rejected', { kind: 'option', title: 'The other way', whyNot: 'slower' }),
  accepted('base'),
  accepted('card'),
  accepted('rejected'),
  linked('card', 'base', 'depends_on'),
  linked('rejected', 'card', 'alternative_to'),
  killed('card'),
  { type: 'node.status_set', payload: { id: 'card', status: 'decided' } },
]

test('64.4 an amend that removes a required fact is refused', () => {
  p = project()
  p.writeLog(decidedCard())
  const before = p.werk(['show', 'card']).stdout
  // There is no amend verb and no verb that removes an edge. Look for one in the help.
  const help = p.werk(['help']).stdout
  const amend = p.werk(['amend', 'card', '--drop-depends-on', 'base'])
  const unlink = p.werk(['unlink', 'card', 'base', '--type', 'depends_on'])
  expect({ amend: amend.code, unlink: unlink.code, help }).toMatchObject({ amend: 1, unlink: 1 })
  const out = amend.stdout + amend.stderr
  expect(out).toContain('basis')
  expect(p.werk(['show', 'card']).stdout).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = project()
  p.writeLog(decidedCard())
  const before = p.lines().length
  const r = p.werk(['edit', 'card', '--body', 'Short.'])
  expect(r.code).toBe(0)
  const show = p.werk(['show', 'card']).stdout
  expect(show).toContain('status: decided')
  expect(show).toContain('Short.')
  const added = p.events().slice(before)
  const types = added.map((e) => `${e.type}${e.type === 'node.status_set' ? ':' + e.payload.status : ''}`)
  expect(types).toEqual(expect.arrayContaining(['node.status_set:open', 'node.status_set:decided']))
})
