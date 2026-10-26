import { afterEach, expect, test } from 'bun:test'
import { acc, kil, lnk, out, project, prop, soft, stat, type P } from './helpers.ts'

let p: P | undefined
afterEach(() => p?.cleanup())

/** A decided real card that other cards can take as their depends_on basis. */
const base = [
  prop('base', 'The base decision', { who: 'me' }),
  acc('base'),
  kil('base'),
  { type: 'node.edited', payload: { id: 'base', noBasis: 'a root decision' } },
  stat('base', 'decided'),
]

const statusOf = (p: P, id: string) => /^status: (\S+)$/m.exec(p.show(id).stdout)?.[1]
const statusEvents = (p: P, id: string) => p.events().filter((e) => e.type === 'node.status_set' && e.payload.id === id).length

/** The printed commands: each line of the output that starts with `werk `. */
const commandsIn = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk ') && !/^werk [a-z-]+: /.test(l))

test('64.1', () => {
  p = project([
    ...base,
    prop('card', 'A card', { who: 'you', status: 'open' }),
    acc('card'),
    lnk('card', 'base', 'depends_on'),
    prop('card-opt', 'A rejected option', { kind: 'option', whyNot: 'It lost' }),
    acc('card-opt'),
    lnk('card-opt', 'card', 'alternative_to'),
  ])
  const s = soft()
  const statusBefore = statusEvents(p, 'card')
  const r = p.werk(['status', 'card', 'decided'])
  const text = out(r)
  s.check(r.code !== 0, `decide exit ${r.code}`)
  s.check(/kill criterion/.test(text) && !/^\s*(who|basis|options):/m.test(text), `output: ${text}`)
  const cmds = commandsIn(text)
  const killCmd = cmds.find((c) => c.startsWith('werk kill card '))
  s.check(killCmd !== undefined, `no kill command printed: ${text}`)
  s.check(statusOf(p, 'card') === 'open', `status is ${statusOf(p, 'card')}`)
  s.check(statusEvents(p, 'card') === statusBefore, 'a status event was appended')
  if (killCmd) {
    const k = p.sh(killCmd)
    s.check(k.code === 0, `printed command exit ${k.code}: ${out(k)}`)
  }
  const again = p.werk(['status', 'card', 'decided'])
  s.check(again.code === 0, `second decide exit ${again.code}: ${out(again)}`)
  s.check(statusOf(p, 'card') === 'decided', `status is ${statusOf(p, 'card')}`)
  expect(s.problems).toEqual([])
})

test('64.2', () => {
  p = project([...base, prop('card', 'A card', { body: 'Some body text', status: 'open' }), acc('card')])
  const s = soft()
  const r = p.werk(['status', 'card', 'decided'])
  const text = out(r)
  s.check(r.code !== 0, `decide exit ${r.code}`)
  for (const fact of ['who', 'basis', 'options', 'kill']) {
    s.check(new RegExp(`^\\s*${fact}:`, 'm').test(text), `output does not name the missing ${fact}`)
  }
  const cmds = commandsIn(text)
  s.check(cmds.length >= 4, `printed ${cmds.length} commands, not one per missing fact (4): ${JSON.stringify(cmds)}`)
  s.check(statusOf(p, 'card') === 'open', `status is ${statusOf(p, 'card')}`)
  // The agent fills a placeholder that names a card with a card that exists. Text placeholders run as printed.
  for (const cmd of cmds) {
    const filled = cmd.replace('<card-it-needs>', 'base')
    const c = p.sh(filled)
    s.check(c.code === 0, `printed command "${filled}" exit ${c.code}: ${out(c)}`)
  }
  const again = p.werk(['status', 'card', 'decided'])
  s.check(again.code === 0, `second decide exit ${again.code}: ${out(again)}`)
  s.check(statusOf(p, 'card') === 'decided', `status is ${statusOf(p, 'card')}`)
  expect(s.problems).toEqual([])
})

test('64.3', () => {
  p = project(base)
  const s = soft()
  const run = (args: string[]) => {
    const r = p!.werk(args)
    expect(r.code, `${args.join(' ')}: ${out(r)}`).toBe(0)
  }
  // The first ghost: decider, depends_on basis, rejected option, kill criterion.
  run(['add', 'g1', '--title', 'First ghost'])
  run(['edit', 'g1', '--who', 'you'])
  run(['link', 'g1', 'base', '--type', 'depends_on'])
  run(['add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'It lost'])
  run(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  run(['kill', 'g1', '--form', 'revisit'])
  // The second ghost: the same, with no depends_on basis.
  run(['add', 'g2', '--title', 'Second ghost'])
  run(['edit', 'g2', '--who', 'you'])
  run(['add', 'g2-opt', '--kind', 'option', '--title', 'Another way two', '--why-not', 'It lost'])
  run(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  run(['kill', 'g2', '--form', 'revisit'])

  const a = p.werk(['status', 'g1', 'decided'])
  s.check(a.code === 0, `first decide exit ${a.code}: ${out(a)}`)
  s.check(statusOf(p, 'g1') === 'decided', `g1 status ${statusOf(p, 'g1')}`)
  const b = p.werk(['status', 'g2', 'decided'])
  const text = out(b)
  s.check(b.code !== 0, `second decide exit ${b.code}`)
  s.check(/^\s*basis:.*depends_on/m.test(text) && commandsIn(text).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on')), `output: ${text}`)
  s.check(statusOf(p, 'g2') !== 'decided', 'g2 shows as decided')
  expect(s.problems).toEqual([])
})

const decidedCard = [
  ...base,
  prop('card', 'A decided card', { who: 'you', body: 'The long original body of the card.', why: 'The why.' }),
  acc('card'),
  lnk('card', 'base', 'depends_on'),
  prop('card-opt', 'A rejected option', { kind: 'option', whyNot: 'It lost' }),
  acc('card-opt'),
  lnk('card-opt', 'card', 'alternative_to'),
  kil('card'),
  stat('card', 'decided'),
]

test('64.4', () => {
  p = project(decidedCard)
  const s = soft()
  const before = p.show('card').stdout
  // No verb removes an edge. The agent's amend is the one verb that names an amend, if it exists.
  const help = p.werk(['help']).stdout
  const verbs = [...help.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]!)
  const remover = verbs.find((v) => /unlink|amend|remove|drop/.test(v))
  s.check(remover !== undefined, `no verb amends a card or removes its depends_on edge. Verbs: ${verbs.join(', ')}`)
  const r = remover ? p.werk([remover, 'card', 'base']) : p.werk(['amend', 'card', '--drop-depends-on', 'base'])
  const text = out(r)
  s.check(r.code !== 0, `amend exit ${r.code}`)
  s.check(/basis/.test(text) && /depends_on/.test(text) && commandsIn(text).some((c) => c.includes('depends_on')), `output does not name the missing basis: ${text}`)
  s.check(statusOf(p, 'card') === 'decided', `status ${statusOf(p, 'card')}`)
  s.check(p.show('card').stdout === before, 'show output changed')
  expect(s.problems).toEqual([])
})

test('64.5', () => {
  p = project(decidedCard)
  const s = soft()
  const n = p.lines().length
  const r = p.werk(['edit', 'card', '--body', 'One short sentence.'])
  s.check(r.code === 0, `amend exit ${r.code}: ${out(r)}`)
  const shown = p.show('card').stdout
  s.check(shown.includes('status: decided') && shown.includes('One short sentence.'), `show: ${shown}`)
  const added = p.events().slice(n)
  const reopen = added.some((e) => e.type === 'node.status_set' && e.payload.id === 'card' && e.payload.status !== 'decided')
  const decide = added.some((e) => e.type === 'node.status_set' && e.payload.id === 'card' && e.payload.status === 'decided')
  s.check(reopen && decide, `the log shows no reopen and decide; new events: ${JSON.stringify(added.map((e) => e.type))}`)
  expect(s.problems).toEqual([])
})
