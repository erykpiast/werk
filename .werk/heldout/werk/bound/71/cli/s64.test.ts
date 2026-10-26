import { afterEach, expect, test } from 'bun:test'
import { decide, logEvents, logLines, makeProject, ok, out, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const real = (id: string, title: string, extra: string[] = []) => {
  ok(p, ['add', id, '--title', title, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}

/** Runs a printed `werk ...` command, with its placeholders filled the way an agent would. */
const runPrinted = (cmd: string, fill: Record<string, string>) => {
  let c = cmd.trim()
  for (const [k, v] of Object.entries(fill)) c = c.split(k).join(v)
  for (const part of c.split(' && ')) {
    const args = [...part.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(args[0]).toBe('werk')
    ok(p, args.slice(1))
  }
}

const statusOf = (id: string) => /status: (\w+)/.exec(show(p, id))?.[1]

/** A basis card that is itself decided, so it can stand under another decide. */
const basisCard = () => {
  real('base', 'Base')
  decide(p, 'base')
}

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  basisCard()
  real('card', 'Card', ['--status', 'open'])
  ok(p, ['edit', 'card', '--who', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'slower'])
  ok(p, ['accept', 'opt', '--actor', 'you'])
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  const before = logLines(p)
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const o = out(r)
  expect(o).toContain('kill criterion')
  expect(o).not.toMatch(/^\s+(who|basis|options):/m)
  const cmd = o.split('\n').find((l) => l.trim().startsWith('werk kill card'))
  expect(cmd).toBeDefined()
  expect(statusOf('card')).toBe('open')
  expect(logLines(p)).toEqual(before)
  runPrinted(cmd!, { '<what you check by use to revisit card>': 'use it for a week' })
  ok(p, ['status', 'card', 'decided'])
  expect(statusOf('card')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  basisCard()
  real('card', 'Card', ['--body', 'Some body text', '--status', 'open'])
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const o = out(r)
  const named = { who: /^\s+who:/m.test(o), basis: /^\s+basis:/m.test(o), options: /^\s+options:/m.test(o), kill: /^\s+kill:/m.test(o) }
  expect(statusOf('card')).toBe('open')
  const cmds = o.split('\n').filter((l) => /^    werk /.test(l))
  for (const cmd of cmds) {
    runPrinted(cmd, {
      '<card-it-needs>': 'base',
      '<what card takes from it>': 'its base',
      '<what you check by use to revisit card>': 'use it for a week',
      '<the option>': 'Other way',
      '<why it lost>': 'slower',
      '--who me': '--who you',
    })
  }
  const again = p.werk(['status', 'card', 'decided'])
  expect({ named, commands: cmds.length }).toEqual({ named: { who: true, basis: true, options: true, kill: true }, commands: 4 })
  expect(again.code).toBe(0)
  expect(statusOf('card')).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  basisCard()
  ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'you'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'g1-opt', '--kind', 'option', '--title', 'Alt', '--why-not', 'worse'])
  ok(p, ['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'revisit'])
  ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'you'])
  ok(p, ['add', 'g2-opt', '--kind', 'option', '--title', 'Alt2', '--why-not', 'worse'])
  ok(p, ['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'revisit'])
  ok(p, ['status', 'g1', 'decided'])
  expect(statusOf('g1')).toBe('decided')
  const r = p.werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toMatch(/basis:.*depends_on/)
  expect(out(r)).toContain('werk link g2')
  expect(statusOf('g2')).not.toBe('decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option and a kill criterion. */
const decidedCard = () => {
  basisCard()
  real('card', 'Card', ['--body', 'A long body that explains the choice in detail.', '--why', 'Because'])
  ok(p, ['edit', 'card', '--who', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'slower'])
  ok(p, ['accept', 'opt', '--actor', 'you'])
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  ok(p, ['kill', 'card', '--form', 'manual', '--text', 'use it a week'])
  ok(p, ['status', 'card', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  decidedCard()
  const before = show(p, 'card')
  const help = p.werk(['help']).stdout
  // No verb removes an edge; the binder looks for one in the help list.
  const unlink = ['unlink', 'remove-link', 'amend'].find((v) => new RegExp(`^\\s*${v}\\b`, 'm').test(help))
  expect(unlink).toBeDefined()
  const r = p.werk([unlink!, 'card', 'base', '--type', 'depends_on'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toMatch(/basis/)
  expect(show(p, 'card')).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  decidedCard()
  const n = logLines(p).length
  ok(p, ['edit', 'card', '--body', 'Short.'])
  const s = show(p, 'card')
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  const added = logEvents(p).slice(n).map((e) => e.type)
  expect(added).toContain('node.reopened')
  expect(added.filter((t) => t === 'node.status_set')).toHaveLength(1)
})
