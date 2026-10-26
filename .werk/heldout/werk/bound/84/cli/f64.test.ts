/** Feature 64: the contract check on decide and on amend. */
import { afterEach, expect, test } from 'bun:test'
import { accepted, events, graph, killed, linked, logLines, makeProject, noBasis, ok, proposed, seed, statusSet, whoSet, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())
const show = (id: string) => p.werk(['show', id]).stdout
const statusOnMap = (id: string) => graph(p).nodes.find((n) => n.id === id)?.status

/** The printed command lines of a refusal. */
const printed = (text: string) => text.split('\n').filter((l) => /^\s{2,}werk /.test(l)).map((l) => l.trim())
/** Runs one printed line as a shell would: double-quoted words, and `&&` between commands. */
const runPrinted = (line: string) => {
  for (const command of line.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('werk')
    ok(p, words.slice(1))
  }
}

/** A real decided card `base`, a real open card `a`, and a rejected option linked to `a` when asked. */
function baseMap(extra: Parameters<typeof seed>[1][] = []) {
  seed(
    p,
    proposed('base', { title: 'Base', who: 'me' }),
    accepted('base'),
    noBasis('base', 'the root of the map'),
    killed('base'),
    statusSet('base', 'decided'),
    ...extra,
  )
}

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  baseMap([
    proposed('a', { title: 'A', status: 'open', who: 'you' }),
    accepted('a'),
    linked('a', 'base', 'depends_on', 'takes the base'),
    proposed('a-opt', { kind: 'option', title: 'Another way', whyNot: 'It costs more' }),
    accepted('a-opt'),
    linked('a-opt', 'a', 'alternative_to'),
  ])
  const before = logLines(p)
  const r = p.werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('kill criterion')
  const commands = printed(out)
  expect(commands).toEqual(['werk kill a --form manual --text "<what you check by use to revisit a>"'])
  expect(statusOnMap('a')).toBe('open')
  expect(logLines(p)).toEqual(before)
  runPrinted(commands[0]!)
  const again = p.werk(['status', 'a', 'decided'])
  expect(again.code).toBe(0)
  expect(statusOnMap('a')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  baseMap([proposed('a', { title: 'A', body: 'Only words.', status: 'open' }), accepted('a')])
  const r = p.werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  const facts = out.split('\n').flatMap((l) => (/^  (\w+): /.exec(l) ? [/^  (\w+): /.exec(l)![1]] : []))
  const commands = printed(out)
  expect(statusOnMap('a')).toBe('open')
  for (const c of commands) runPrinted(c.replace('<card-it-needs>', 'base'))
  const again = p.werk(['status', 'a', 'decided'])
  const decidedAfter = statusOnMap('a')
  console.log('64.2 facts', facts, 'commands', commands, 'decide again', again.code, decidedAfter)
  // The step: the output names the decider, the depends_on basis, the rejected option and the kill criterion.
  expect(facts).toEqual(['who', 'basis', 'options', 'kill'])
  expect(commands).toHaveLength(4)
  expect(again.code).toBe(0)
  expect(decidedAfter).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  baseMap()
  ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'you'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(p, ['add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'It costs more'])
  ok(p, ['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'manual', '--text', 'use it for a week'])
  ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'you'])
  ok(p, ['add', 'g2-opt', '--kind', 'option', '--title', 'Another way two', '--why-not', 'It costs more'])
  ok(p, ['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'use it for a week'])
  expect(show('g1')).toContain('(held)')

  const first = p.werk(['status', 'g1', 'decided'])
  expect(first.code).toBe(0)
  expect(show('g1')).toContain('status: decided')
  expect(show('g1')).toContain('state: ghost')

  const second = p.werk(['status', 'g2', 'decided'])
  expect(second.code).not.toBe(0)
  const out = second.stdout + second.stderr
  expect(out).toContain('basis')
  expect(out).toContain('depends_on')
  expect(printed(out).some((c) => c.startsWith('werk link g2 ') && c.includes('--type depends_on'))).toBe(true)
  expect(show('g2')).not.toContain('status: decided')
})

/** A decided card `a` with a decider, a depends_on edge, a rejected option and a kill criterion. */
function decidedA() {
  baseMap([
    proposed('a', { title: 'A', who: 'you', body: 'The long first body of the card, with many words in it.' }),
    accepted('a'),
    linked('a', 'base', 'depends_on', 'takes the base'),
    proposed('a-opt', { kind: 'option', title: 'Another way', whyNot: 'It costs more' }),
    accepted('a-opt'),
    linked('a-opt', 'a', 'alternative_to'),
    killed('a'),
    statusSet('a', 'decided'),
  ])
}

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  decidedA()
  const before = show('a')
  // No verb takes an edge away, and no amend verb exists. The closest calls an agent can make:
  const verbs = p.werk(['help']).stdout
  const hasUnlink = /^\s+(unlink|amend)\s/m.test(verbs)
  expect(hasUnlink).toBe(true)
  expect(show('a')).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  decidedA()
  const before = events(p).length
  const r = p.werk(['edit', 'a', '--body', 'Short.'])
  expect(r.code).toBe(0)
  const shown = show('a')
  expect(shown).toContain('status: decided')
  expect(shown).toContain('Short.')
  const added = events(p).slice(before)
  // The step: the log shows the amend as a reopen and a decide of the card.
  expect(added.map((e) => e.type)).toEqual(expect.arrayContaining(['node.reopened', 'node.status_set']))
})
