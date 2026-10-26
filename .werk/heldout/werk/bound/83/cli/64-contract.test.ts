/** Held-out steps 64.x: the contract check on decide and amend. */
import { expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { decidedCard, events, graph, lines, ok, project, realCard, show, statusInMap } from './helpers.ts'

/** The printed fix commands: the indented lines that start with `werk `. */
const commandsOf = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^\s{4}werk /.test(l))
    .map((l) => l.trim())

/** Runs one printed command line, which may chain two werk calls with &&, through the harness. */
function runPrinted(p: Project, line: string, fill: Record<string, string>) {
  let filled = line
  for (const [k, v] of Object.entries(fill)) filled = filled.replaceAll(k, v)
  for (const part of filled.split(' && ')) {
    const argv = [...part.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(argv[0]).toBe('werk')
    const r = p.werk(argv.slice(1))
    if (r.code !== 0) throw new Error(`printed command failed: ${part}: ${r.stderr}`)
  }
}

const PLACEHOLDERS = {
  '<card-it-needs>': 'base',
  '<what you check by use to revisit card>': 'two weeks of use',
  '<the option>': 'Another way',
  '<why it lost>': 'It cost more',
  '<reason>': 'a root card',
}
const fillFor = (id: string) =>
  Object.fromEntries(Object.entries(PLACEHOLDERS).map(([k, v]) => [k.replace('card>', `${id}>`), v])) as Record<string, string>

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const p = project()
  decidedCard(p, 'base', { title: 'Base' })
  realCard(p, 'card', 'The card')
  ok(p, ['status', 'card', 'open'])
  ok(p, ['edit', 'card', '--who', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Other', '--why-not', 'Slower'])
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  ok(p, ['accept', 'opt', '--actor', 'you'])
  const before = lines(p)
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/i)
  expect(out).not.toMatch(/^\s+(who|basis|options):/m)
  const cmds = commandsOf(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toStartWith('werk kill card ')
  expect(statusInMap(p, 'card')).toBe('open')
  expect(lines(p)).toEqual(before)
  runPrinted(p, cmds[0]!, fillFor('card'))
  ok(p, ['status', 'card', 'decided'])
  expect(statusInMap(p, 'card')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  const p = project()
  decidedCard(p, 'base', { title: 'Base' })
  ok(p, ['add', 'card', '--title', 'The card', '--body', 'Some body text.'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  ok(p, ['status', 'card', 'open'])
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  console.log(`64.2 refusal:\n${out}`)
  const named = ['who', 'basis', 'options', 'kill'].filter((fact) => new RegExp(`^\\s+${fact}:`, 'm').test(out))
  const cmds = commandsOf(out)
  expect(statusInMap(p, 'card')).toBe('open')
  // The missing decider, basis and kill each print a command. The option fact appears when the
  // decider is the person; we follow the printed commands in turn, and decide again.
  for (const c of cmds) runPrinted(p, c, fillFor('card'))
  const again = p.werk(['status', 'card', 'decided'])
  console.log(`64.2 second decide: ${again.code} ${again.stderr}`)
  expect(again.code).toBe(0)
  expect(statusInMap(p, 'card')).toBe('decided')
  console.log(`64.2 facts named: ${named.join(', ')}`)
  expect(named).toEqual(['who', 'basis', 'options', 'kill'])
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  const p = project()
  decidedCard(p, 'base', { title: 'Base' })
  ok(p, ['add', 'g1', '--title', 'First ghost', '--who', 'you'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'g1opt', '--kind', 'option', '--title', 'Other', '--why-not', 'Slower'])
  ok(p, ['link', 'g1opt', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'revisit'])
  ok(p, ['add', 'g2', '--title', 'Second ghost', '--who', 'you'])
  ok(p, ['add', 'g2opt', '--kind', 'option', '--title', 'Other', '--why-not', 'Slower'])
  ok(p, ['link', 'g2opt', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'revisit'])

  ok(p, ['status', 'g1', 'decided'])
  expect(statusInMap(p, 'g1')).toBe('decided')
  expect(show(p, 'g1').stdout).toContain('status: decided')

  const r = p.werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/^\s+basis:/m)
  expect(commandsOf(out).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on'))).toBe(true)
  expect(statusInMap(p, 'g2')).not.toBe('decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option, and a kill criterion. */
function fullDecided(p: Project) {
  decidedCard(p, 'base', { title: 'Base' })
  ok(p, ['add', 'card', '--title', 'The card', '--body', 'A long body. It has many sentences.', '--who', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Other', '--why-not', 'Slower'])
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  ok(p, ['kill', 'card', '--form', 'revisit'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  ok(p, ['status', 'card', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  const p = project()
  fullDecided(p)
  const before = show(p, 'card').stdout
  const edgesBefore = graph(p).edges.filter((e) => e.from === 'card' || e.to === 'card')
  // There is no unlink verb. The only amend that drops the depends_on basis on this command
  // line is a no-basis waiver... which adds a basis fact instead. Look for an amend verb first.
  const help = p.werk(['help']).stdout
  const amendVerb = /^ {2}(amend|unlink)\s/m.exec(help)?.[1]
  expect(amendVerb, 'no amend or unlink verb to remove a depends_on edge').toBeDefined()
  const r = p.werk([amendVerb!, 'card', 'base', '--type', 'depends_on'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/basis/)
  expect(show(p, 'card').stdout).toBe(before)
  expect(graph(p).edges.filter((e) => e.from === 'card' || e.to === 'card')).toEqual(edgesBefore)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  const p = project()
  fullDecided(p)
  const n = events(p).length
  const r = p.werk(['edit', 'card', '--body', 'Short.'])
  expect(r.code).toBe(0)
  const s = show(p, 'card').stdout
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  const added = events(p).slice(n)
  console.log(`64.5 new events: ${JSON.stringify(added.map((e) => e.type))}`)
  const types = added.map((e) => e.type)
  expect(types).toContain('node.reopened')
  expect(types).toContain('node.status_set')
})
