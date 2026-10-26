import { afterEach, expect, test } from 'bun:test'
import type { NewEvent } from '../src/map/events.ts'
import { decidedCard, project, realCard, staleEntries, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const statusOf = (out: string) => /^status: (\S+)$/m.exec(out)?.[1]
/** The command lines a refusal prints: the indented lines that start with `werk `. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk ') && !/^werk [\w-]+: /.test(l))

const statusEvents = (p: P, id: string) => p.events().filter((e) => e.type === 'node.status_set' && e.payload.id === id).length

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = project()
  p.writeLog([
    ...decidedCard('base'),
    ...realCard('x', 'The card'),
    { type: 'node.status_set', payload: { id: 'x', status: 'open' } },
    { type: 'node.edited', payload: { id: 'x', who: 'you' } },
    { type: 'edge.linked', payload: { from: 'x', to: 'base', type: 'depends_on' } },
    ...realCard('x-opt', 'Another way'),
    { type: 'node.edited', payload: { id: 'x-opt', why: 'w' } },
  ] as NewEvent[])
  // The option: an option node with a why-not, weighed against x.
  p.writeLog([
    ...decidedCard('base'),
    ...realCard('x', 'The card'),
    { type: 'node.status_set', payload: { id: 'x', status: 'open' } },
    { type: 'node.edited', payload: { id: 'x', who: 'you' } },
    { type: 'edge.linked', payload: { from: 'x', to: 'base', type: 'depends_on' } },
    { type: 'node.proposed', payload: { id: 'x-opt', kind: 'option', title: 'Another way', whyNot: 'It lost' } },
    { type: 'node.accepted', payload: { id: 'x-opt' } },
    { type: 'edge.linked', payload: { from: 'x-opt', to: 'x', type: 'alternative_to' } },
  ])
  const before = statusEvents(p, 'x')
  const r = p.werk(['status', 'x', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/)
  expect(out).not.toMatch(/^\s+who:/m)
  expect(out).not.toMatch(/^\s+basis:/m)
  expect(out).not.toMatch(/^\s+options:/m)
  const cmds = printedCommands(out)
  const killCmd = cmds.find((c) => c.startsWith('werk kill x '))
  expect(killCmd).toBeDefined()
  expect(statusOf(p.show('x').stdout)).toBe('open')
  expect(statusEvents(p, 'x')).toBe(before)
  const fix = p.sh(killCmd!)
  expect({ fix: killCmd, ...fix }).toMatchObject({ code: 0 })
  expect(p.werk(['status', 'x', 'decided']).code).toBe(0)
  expect(statusOf(p.show('x').stdout)).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = project()
  p.writeLog([
    ...decidedCard('base'),
    { type: 'node.proposed', payload: { id: 'x', kind: 'card', title: 'The card', body: 'Only body text' } },
    { type: 'node.accepted', payload: { id: 'x' } },
    { type: 'node.status_set', payload: { id: 'x', status: 'open' } },
  ])
  const r = p.werk(['status', 'x', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  const missing = ['who', 'basis', 'options', 'kill'].filter((f) => new RegExp(`^\\s+${f}:`, 'm').test(out))
  const cmds = printedCommands(out)
  expect(statusOf(p.show('x').stdout)).toBe('open')
  // Run each printed command in turn. Placeholders are filled the way an agent fills them.
  const results = cmds.map((c) => {
    const filled = c.replace(/<card-it-needs>/g, 'base').replace(/<[^>"]*>/g, 'filled in')
    return { c: filled, code: p.sh(filled).code }
  })
  const again = p.werk(['status', 'x', 'decided'])
  const final = statusOf(p.show('x').stdout)
  console.log("64.2 DEBUG", JSON.stringify({ cmds, results, again: again.code, final }))
  expect({ missing, commandCount: cmds.length }).toEqual({ missing: ['who', 'basis', 'options', 'kill'], commandCount: 4 })
  expect(results.every((x) => x.code === 0)).toBe(true)
  expect(again.code).toBe(0)
  expect(final).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = project()
  p.writeLog(decidedCard('base'))
  const ok = (args: string[]) => expect({ args, ...p.werk(args) }).toMatchObject({ code: 0 })
  ok(['add', 'g1', '--title', 'First ghost'])
  ok(['edit', 'g1', '--who', 'you'])
  ok(['link', 'g1', 'base', '--type', 'depends_on'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'lost'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'revisit'])
  ok(['add', 'g2', '--title', 'Second ghost'])
  ok(['edit', 'g2', '--who', 'you'])
  ok(['add', 'g2-opt', '--kind', 'option', '--title', 'Other 2', '--why-not', 'lost'])
  ok(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'revisit'])

  expect(p.werk(['status', 'g1', 'decided']).code).toBe(0)
  const s1 = p.show('g1').stdout
  expect(s1).toMatch(/ghost/)
  expect(statusOf(s1)).toBe('decided')
  const r = p.werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s+basis:/m)
  expect(printedCommands(out).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on'))).toBe(true)
  expect(statusOf(p.show('g2').stdout)).not.toBe('decided')
})

/** A decided card d with who you, depends_on base, an option and a kill criterion. */
const decidedWithFacts = (): NewEvent[] => [
  ...decidedCard('base'),
  { type: 'node.proposed', payload: { id: 'd', kind: 'card', title: 'The decided card', body: 'A long body with many words in it.' } },
  { type: 'node.edited', payload: { id: 'd', who: 'you' } },
  { type: 'edge.linked', payload: { from: 'd', to: 'base', type: 'depends_on' } },
  { type: 'node.proposed', payload: { id: 'd-opt', kind: 'option', title: 'Other', whyNot: 'lost' } },
  { type: 'edge.linked', payload: { from: 'd-opt', to: 'd', type: 'alternative_to' } },
  { type: 'kill.recorded', payload: { id: 'd', criterion: { form: 'revisit' } } },
  { type: 'node.accepted', payload: { id: 'd' } },
  { type: 'node.accepted', payload: { id: 'd-opt' } },
  { type: 'node.status_set', payload: { id: 'd', status: 'decided' } },
]

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = project()
  p.writeLog(decidedWithFacts())
  const before = p.show('d').stdout
  // No verb removes an edge. The binder looks for one in the help output.
  const help = p.werk(['help']).stdout
  const verbs = help
    .split('\n')
    .map((l) => /^ {2}(\S+)/.exec(l)?.[1])
    .filter(Boolean)
  const remover = verbs.find((v) => /unlink|amend|remove/.test(v!))
  expect({ verbFound: remover, verbs }).toMatchObject({ verbFound: expect.any(String) })
  const r = p.werk([remover!, 'd', 'base', '--type', 'depends_on'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/basis/)
  expect(statusOf(p.show('d').stdout)).toBe('decided')
  expect(p.show('d').stdout).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = project()
  p.writeLog(decidedWithFacts())
  const n = p.events().length
  const r = p.werk(['edit', 'd', '--body', 'Short.'])
  expect(r.code).toBe(0)
  const s = p.show('d').stdout
  expect(statusOf(s)).toBe('decided')
  expect(s).toContain('Short.')
  const added = p.events().slice(n).map((e) => e.type)
  expect(added).toContain('node.reopened')
  expect(added.filter((t) => t === 'node.status_set').length).toBeGreaterThan(0)
})

// ---- 65: reopen, stale, paused

const ok = (args: string[]) => expect({ args, ...p.werk(args) }).toMatchObject({ code: 0 })
const stale = () => staleEntries(p.werk(['stale']).stdout)

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = project()
  p.writeLog([...decidedCard('a'), ...decidedCard('b', { deps: ['a'] }), ...decidedCard('c', { deps: ['b'] })])
  ok(['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const list = stale()
  const b = list.find((e) => e.id === 'b')
  expect(b?.mark).toBe('stale')
  expect(b!.traces.join('\n')).toMatch(/rejected #a .*depends_on/)
  expect(list.find((e) => e.id === 'c')).toBeUndefined()
  expect(p.show('c').stdout).not.toMatch(/stale|paused/)
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = project()
  p.writeLog([
    ...decidedCard('a'),
    ...decidedCard('b', { deps: ['a'] }),
    ...decidedCard('c', { deps: ['b'] }),
    ...decidedCard('d', { deps: ['c'] }),
  ])
  ok(['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const list = stale()
  for (const id of ['b', 'c', 'd']) expect(list.find((e) => e.id === id)?.mark).toBe('paused')
  expect(statusOf(p.show('d').stdout)).toBe('decided')
  const d = list.find((e) => e.id === 'd')!
  expect(d.traces.join('\n')).toMatch(/postponed #a/)
  expect(list.filter((e) => e.mark === 'stale')).toEqual([])
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = project()
  p.writeLog([...decidedCard('a'), ...decidedCard('b'), ...decidedCard('c', { deps: ['a'], parent: 'b' })])
  ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  const c = stale().find((e) => e.id === 'c')
  expect(c?.mark).toBe('stale')
  expect(c!.traces.join('\n')).toMatch(/rejected #b/)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = project()
  p.writeLog([...decidedCard('a'), ...decidedCard('b', { deps: ['a'] }), ...decidedCard('c', { deps: ['a'] })])
  ok(['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  expect(stale().filter((e) => e.mark === 'stale').map((e) => e.id).toSorted()).toEqual(['b', 'c'])
  ok(['rederive', 'b', 'confirm', '--why', 'still holds'])
  const list = stale()
  expect(list.find((e) => e.id === 'b')).toBeUndefined()
  const c = list.find((e) => e.id === 'c')
  expect(c?.mark).toBe('stale')
  expect(c!.traces.join('\n')).toMatch(/rejected #a/)
  expect(p.show('b').stdout).not.toMatch(/stale/)
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = project()
  p.writeLog([...decidedCard('a'), ...decidedCard('b', { deps: ['a'] }), ...decidedCard('c', { deps: ['b'] })])
  const cStatus = statusOf(p.show('c').stdout)
  ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  expect(stale().filter((e) => e.mark === 'paused').map((e) => e.id).toSorted()).toEqual(['b', 'c'])
  ok(['status', 'a', 'decided'])
  const list = stale()
  expect(list.find((e) => e.id === 'b')).toBeUndefined()
  expect(list.find((e) => e.id === 'c')).toBeUndefined()
  expect(statusOf(p.show('c').stdout)).toBe(cStatus)
})
