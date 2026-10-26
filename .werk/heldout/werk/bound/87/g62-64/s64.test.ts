import { afterEach, expect, test } from 'bun:test'
import { decide, graph, project, realCard, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** Splits one printed command line into argv, with double quotes, the way a shell does for these lines. */
function argv(line: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2]!)
  return out
}

/** The printed `werk ...` command lines in a refusal, each split at `&&`. */
const printedCommands = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk ') && !/^werk \S+:/.test(l))
    .flatMap((l) => l.split(' && ').map((c) => argv(c).slice(1)))

const nodeStatus = (id: string) => graph(p).nodes.find((n) => n.id === id)?.status
const statusEvents = (id: string) => p.events().filter((e) => e.type === 'node.status_set' && e.payload.id === id).length

/** A decided card that other cards can take as their basis. */
function base() {
  realCard(p, 'base', 'Base')
  decide(p, 'base')
}

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = project()
  base()
  realCard(p, 'c', 'Card', ['--status', 'open'])
  p.ok(['edit', 'c', '--who', 'you'])
  p.ok(['link', 'c', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  p.ok(['add', 'c:opt0', '--kind', 'option', '--title', 'Other way', '--why-not', 'slower'])
  p.ok(['link', 'c:opt0', 'c', '--type', 'alternative_to'])
  p.ok(['accept', 'c:opt0', '--actor', 'you'])
  const before = statusEvents('c')
  const r = p.werk(['status', 'c', 'decided'])
  const text = r.stdout + r.stderr
  expect(r.code).not.toBe(0)
  expect(text).toContain('kill criterion')
  expect(text).not.toMatch(/\bwho:|basis:|options:/)
  const cmds = printedCommands(text)
  expect(cmds.length).toBe(1)
  expect(cmds[0]!.slice(0, 2)).toEqual(['kill', 'c'])
  expect(nodeStatus('c')).toBe('open')
  expect(statusEvents('c')).toBe(before)
  p.ok(cmds[0]!)
  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(nodeStatus('c')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each with its own command', () => {
  p = project()
  base()
  realCard(p, 'c', 'Card', ['--status', 'open', '--body', 'Some body text'])
  const r = p.werk(['status', 'c', 'decided'])
  const text = r.stdout + r.stderr
  expect(r.code).not.toBe(0)
  for (const fact of ['who:', 'basis:', 'options:', 'kill:']) expect(text).toContain(fact)
  expect(text).toContain('depends_on')
  expect(text).toContain('option')
  expect(text).toContain('kill criterion')
  const cmds = printedCommands(text)
  const verbs = cmds.map((c) => c[0])
  expect(verbs).toContain('edit')
  expect(verbs).toContain('link')
  expect(verbs).toContain('add')
  expect(verbs).toContain('kill')
  expect(nodeStatus('c')).toBe('open')
  for (const cmd of cmds) {
    // The agent fills the one placeholder that must name a real card.
    const filled = cmd.map((a) => (a === '<card-it-needs>' ? 'base' : a))
    p.ok(filled)
  }
  p.werk(['status', 'c', 'decided'])
  expect(nodeStatus('c')).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = project()
  base()
  p.ok(['add', 'g1', '--title', 'Ghost one'])
  p.ok(['edit', 'g1', '--who', 'you'])
  p.ok(['link', 'g1', 'base', '--type', 'depends_on'])
  p.ok(['add', 'g1:opt0', '--kind', 'option', '--title', 'Other', '--why-not', 'slower'])
  p.ok(['link', 'g1:opt0', 'g1', '--type', 'alternative_to'])
  p.ok(['kill', 'g1', '--form', 'revisit'])
  p.ok(['add', 'g2', '--title', 'Ghost two'])
  p.ok(['edit', 'g2', '--who', 'you'])
  p.ok(['add', 'g2:opt0', '--kind', 'option', '--title', 'Other', '--why-not', 'slower'])
  p.ok(['link', 'g2:opt0', 'g2', '--type', 'alternative_to'])
  p.ok(['kill', 'g2', '--form', 'revisit'])
  expect(p.show('g1')).toContain('(held)')
  expect(p.werk(['status', 'g1', 'decided']).code).toBe(0)
  expect(nodeStatus('g1')).toBe('decided')
  const r = p.werk(['status', 'g2', 'decided'])
  const text = r.stdout + r.stderr
  expect(r.code).not.toBe(0)
  expect(text).toContain('basis:')
  expect(text).toContain('depends_on')
  expect(printedCommands(text).some((c) => c[0] === 'link' && c.includes('depends_on'))).toBe(true)
  expect(nodeStatus('g2')).not.toBe('decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option and a kill criterion. */
function decidedCard() {
  base()
  realCard(p, 'c', 'Card', ['--status', 'open', '--body', 'The long first body of the card.', '--why', 'Because'])
  p.ok(['edit', 'c', '--who', 'you'])
  p.ok(['link', 'c', 'base', '--type', 'depends_on'])
  p.ok(['add', 'c:opt0', '--kind', 'option', '--title', 'Other way', '--why-not', 'slower'])
  p.ok(['link', 'c:opt0', 'c', '--type', 'alternative_to'])
  p.ok(['accept', 'c:opt0', '--actor', 'you'])
  p.ok(['kill', 'c', '--form', 'manual', '--text', 'check it'])
  p.ok(['status', 'c', 'decided'])
}

test('64.4 an amend that removes a required fact is refused', () => {
  p = project()
  decidedCard()
  const before = p.show('c')
  const r = p.werk(['amend', 'c', '--unlink', 'base', '--summary', 'drop the base'])
  const text = r.stdout + r.stderr
  expect(r.code).not.toBe(0)
  expect(text).toContain('basis:')
  expect(text).toContain('depends_on')
  expect(printedCommands(text).some((c) => c[0] === 'link' && c.includes('depends_on'))).toBe(true)
  expect(nodeStatus('c')).toBe('decided')
  expect(p.show('c')).toBe(before)
})

test('64.5 an amend that keeps every fact succeeds', () => {
  p = project()
  decidedCard()
  const n = p.lines().length
  const r = p.werk(['amend', 'c', '--body', 'One short sentence.', '--summary', 'shorter body'])
  expect(r.code).toBe(0)
  expect(nodeStatus('c')).toBe('decided')
  expect(p.show('c')).toContain('One short sentence.')
  const added = p.events().slice(n)
  const types = added.map((e) => e.type)
  expect(added[0]).toMatchObject({ type: 'node.reopened', payload: { id: 'c' } })
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'c', status: 'decided' } })
  expect(types).toContain('node.edited')
})
