/**
 * Held-out binding for steps 64.1-64.5 (contract check) and 65.1-65.5 (stale and paused marks).
 * "Shows on the map" reads the same pure function the server sends on GET /api/graph:
 * graphOf(readLog(<project>/.werk/log.jsonl)). "The stale list" is `werk stale`.
 */
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { graphOf } from '../src/map/graph.ts'
import { readLog } from '../src/map/log.ts'
import type { Event } from '../src/map/events.ts'

setDefaultTimeout(60_000)

const projects: Project[] = []
afterEach(() => {
  for (const p of projects.splice(0)) p.cleanup()
})
const project = () => {
  const p = makeProject()
  projects.push(p)
  return p
}

const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`setup: werk ${args.join(' ')} failed (${r.code}): ${r.stderr}${r.stdout}`)
  return r
}
const log = (p: Project) => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const graph = (p: Project) => graphOf(log(p))
const node = (p: Project, id: string) => graph(p).nodes.find((n) => n.id === id)
const mark = (p: Project, id: string) => graph(p).marks[id]?.mark
const stale = (p: Project) => ok(p, ['stale']).stdout

/**
 * A decided card with all four facts: decider "prototype" (so no option fact is required),
 * a depends_on link to each basis or a --no-basis reason, and a revisit kill criterion.
 * The person accepts it, then it is set to decided.
 */
function decidedCard(p: Project, id: string, opts: { dependsOn?: string[]; refines?: string } = {}) {
  ok(p, ['add', id, '--title', `Card ${id}`, '--who', 'prototype', '--status', 'open'])
  const basis = opts.dependsOn ?? []
  for (const b of basis) ok(p, ['link', id, b, '--type', 'depends_on', '--why', `${id} uses ${b}`])
  if (opts.refines) ok(p, ['link', id, opts.refines, '--type', 'refines'])
  if (basis.length === 0 && !opts.refines) ok(p, ['edit', id, '--no-basis', 'a root decision'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['accept', id, '--actor', 'you'])
  ok(p, ['status', id, 'decided'])
}

/** A rejected option weighed against `id`: an option with a why-not, linked alternative_to. */
function rejectedOption(p: Project, id: string, accept = true) {
  const opt = `${id}:opt0`
  ok(p, ['add', opt, '--kind', 'option', '--title', 'Use files', '--why-not', 'too slow'])
  ok(p, ['link', opt, id, '--type', 'alternative_to'])
  if (accept) ok(p, ['accept', opt, '--actor', 'you'])
}

/** The command lines a refusal prints: the indented lines that start with `werk `. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

/** Splits a shell-like line on spaces, with double-quoted parts kept whole. */
function words(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]!)
  return out
}

/** Runs one printed command as an agent would: fill in the placeholders, run each `&&` part. */
function runPrinted(p: Project, command: string, fill: Record<string, string>) {
  let line = command
  for (const [k, v] of Object.entries(fill)) line = line.replaceAll(k, v)
  line = line.replace(/<[^>]*>/g, 'filled in by the agent')
  for (const part of line.split(' && ')) {
    const [werk, ...args] = words(part)
    expect(werk).toBe('werk')
    const r = p.werk(args)
    expect(r.code, `printed command failed: ${part}\n${r.stderr}`).toBe(0)
  }
}

const outOf = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr

test('64.1 A card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const p = project()
  decidedCard(p, 'store')
  ok(p, ['add', 'cache', '--title', 'Cache in memory', '--who', 'you', '--status', 'open'])
  ok(p, ['link', 'cache', 'store', '--type', 'depends_on', '--why', 'reads the store'])
  ok(p, ['accept', 'cache', '--actor', 'you'])
  rejectedOption(p, 'cache')
  expect(node(p, 'cache')?.status).toBe('open')

  const eventsBefore = log(p).length
  const r = p.werk(['status', 'cache', 'decided'])
  expect(r.code).not.toBe(0)
  const out = outOf(r)
  expect(out).toContain('kill: cache has no kill criterion')
  expect(out).not.toContain('who:')
  expect(out).not.toContain('basis:')
  expect(out).not.toContain('options:')
  const cmds = printedCommands(out)
  expect(cmds).toEqual(['werk kill cache --form manual --text "<what you check by use to revisit cache>"'])
  expect(node(p, 'cache')?.status).toBe('open')
  expect(log(p).length).toBe(eventsBefore)
  expect(log(p).filter((e) => e.type === 'node.status_set' && e.payload.id === 'cache')).toHaveLength(0)

  runPrinted(p, cmds[0]!, {})
  const again = p.werk(['status', 'cache', 'decided'])
  expect(again.code).toBe(0)
  expect(node(p, 'cache')?.status).toBe('decided')
})

test('64.2 A card that lacks several facts reports each missing fact with its own command', () => {
  const p = project()
  decidedCard(p, 'store')
  ok(p, ['add', 'cache', '--title', 'Cache in memory', '--body', 'Keep hot rows in memory.', '--status', 'open'])
  ok(p, ['accept', 'cache', '--actor', 'you'])

  const r = p.werk(['status', 'cache', 'decided'])
  expect(r.code).not.toBe(0)
  const out = outOf(r)
  expect(out).toContain('who: no one is named to decide cache')
  expect(out).toContain('basis: cache has no depends_on target')
  expect(out).toContain('options: cache has no decider')
  expect(out).toContain('kill: cache has no kill criterion')
  const cmds = printedCommands(out)
  expect(cmds).toHaveLength(4)
  expect(cmds[0]).toContain('werk edit cache --who')
  expect(cmds[1]).toContain('werk link cache <card-it-needs> --type depends_on')
  expect(cmds[2]).toContain('--kind option')
  expect(cmds[3]).toContain('werk kill cache')
  expect(node(p, 'cache')?.status).toBe('open')

  for (const c of cmds) runPrinted(p, c, { '<card-it-needs>': 'store' })
  const again = p.werk(['status', 'cache', 'decided'])
  expect(again.code, outOf(again)).toBe(0)
  expect(node(p, 'cache')?.status).toBe('decided')
})

test('64.3 A ghost card obeys the same check through its held edges', () => {
  const p = project()
  decidedCard(p, 'store')
  // Ghost 1: decider, held depends_on edge, held alternative_to from a ghost option, kill criterion (a fact, not an edge).
  ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'you', '--status', 'open'])
  ok(p, ['link', 'g1', 'store', '--type', 'depends_on', '--why', 'reads the store'])
  rejectedOption(p, 'g1', false)
  ok(p, ['kill', 'g1', '--form', 'manual', '--text', 'check the hit rate'])
  // Ghost 2: same, but no depends_on basis.
  ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'you', '--status', 'open'])
  rejectedOption(p, 'g2', false)
  ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'check the hit rate'])
  expect(graph(p).ghostEdges.some((e) => e.from === 'g1' && e.to === 'store' && e.type === 'depends_on')).toBe(true)

  const r1 = p.werk(['status', 'g1', 'decided'])
  expect(r1.code, outOf(r1)).toBe(0)
  expect(node(p, 'g1')?.status).toBe('decided')
  expect(node(p, 'g1')?.proposed).toBe(true)

  const r2 = p.werk(['status', 'g2', 'decided'])
  expect(r2.code).not.toBe(0)
  const out = outOf(r2)
  expect(out).toContain('basis: g2 has no depends_on target')
  expect(printedCommands(out)).toContain('werk link g2 <card-it-needs> --type depends_on --why "<what g2 takes from it>"')
  expect(node(p, 'g2')?.status).not.toBe('decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option and a kill criterion. */
function fullDecided(p: Project) {
  decidedCard(p, 'store')
  ok(p, ['add', 'cache', '--title', 'Cache in memory', '--who', 'you', '--body', 'Keep hot rows in memory for speed.', '--status', 'open'])
  ok(p, ['link', 'cache', 'store', '--type', 'depends_on', '--why', 'reads the store'])
  ok(p, ['accept', 'cache', '--actor', 'you'])
  rejectedOption(p, 'cache')
  ok(p, ['kill', 'cache', '--form', 'manual', '--text', 'check the hit rate'])
  ok(p, ['status', 'cache', 'decided'])
}

test('64.4 An amend that removes a required fact is refused and the decided card stays the same', () => {
  const p = project()
  fullDecided(p)
  const showBefore = ok(p, ['show', 'cache']).stdout
  const logBefore = log(p).length

  const r = p.werk(['amend', 'cache', '--summary', 'drop the store link', '--unlink', 'store'])
  expect(r.code).not.toBe(0)
  const out = outOf(r)
  expect(out).toContain('basis: cache has no depends_on target')
  expect(printedCommands(out)).toContain('werk link cache <card-it-needs> --type depends_on --why "<what cache takes from it>"')
  expect(node(p, 'cache')?.status).toBe('decided')
  expect(ok(p, ['show', 'cache']).stdout).toBe(showBefore)
  expect(log(p).length).toBe(logBefore)
})

test('64.5 An amend that keeps every fact succeeds, and card text is not checked', () => {
  const p = project()
  fullDecided(p)
  const logBefore = log(p).length

  const r = p.werk(['amend', 'cache', '--summary', 'shorter body', '--body', 'Cache rows.'])
  expect(r.code, outOf(r)).toBe(0)
  expect(node(p, 'cache')?.status).toBe('decided')
  expect(node(p, 'cache')?.body).toBe('Cache rows.')
  const shown = ok(p, ['show', 'cache']).stdout
  expect(shown).toContain('status: decided')
  expect(shown).toContain('Cache rows.')

  const added = log(p).slice(logBefore)
  const reopenAt = added.findIndex((e) => e.type === 'node.reopened' && e.payload.id === 'cache')
  const decideAt = added.findIndex((e) => e.type === 'node.status_set' && e.payload.id === 'cache' && e.payload.status === 'decided')
  expect(reopenAt).toBeGreaterThanOrEqual(0)
  expect(decideAt).toBeGreaterThan(reopenAt)
})

test('65.1 A rejected reopen marks only the next hop as stale', () => {
  const p = project()
  decidedCard(p, 'A')
  decidedCard(p, 'B', { dependsOn: ['A'] })
  decidedCard(p, 'C', { dependsOn: ['B'] })

  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = stale(p)
  expect(out).toMatch(/^stale\s+#B\b/m)
  expect(out).toMatch(/^\s+rejected #A \(event \d+\), along depends_on: the storage choice is wrong$/m)
  expect(out).not.toContain('#C')
  expect(mark(p, 'C')).toBeUndefined()
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', () => {
  const p = project()
  decidedCard(p, 'A')
  decidedCard(p, 'B', { dependsOn: ['A'] })
  decidedCard(p, 'C', { dependsOn: ['B'] })
  decidedCard(p, 'D', { dependsOn: ['C'] })

  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  for (const id of ['B', 'C', 'D']) expect(mark(p, id)).toBe('paused')
  expect(node(p, 'D')?.status).toBe('decided')
  const out = stale(p)
  const dEntry = out.split('\n').slice(out.split('\n').findIndex((l) => /^paused\s+#D\b/.test(l)))
  expect(dEntry[0]).toMatch(/^paused\s+#D\b/)
  expect(dEntry[1]).toMatch(/^\s+postponed #A \(event \d+\), along depends_on through #C: the engine build waits for next quarter$/)
  expect(Object.values(graph(p).marks).some((m) => m.mark === 'stale')).toBe(false)
  expect(out).not.toMatch(/^stale\s/m)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', () => {
  const p = project()
  decidedCard(p, 'A')
  decidedCard(p, 'B')
  decidedCard(p, 'C', { dependsOn: ['A'], refines: 'B' })

  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'B', '--reason', 'rejected', '--why', 'wrong parent'])
  expect(mark(p, 'C')).toBe('stale')
  const out = stale(p)
  expect(out).toMatch(/^stale\s+#C\b/m)
  expect(out).not.toMatch(/^paused\s+#C\b/m)
  expect(out).toMatch(/^\s+rejected #B \(event \d+\), along refines: wrong parent$/m)
})

test('65.4 Rederive clears the mark on one card and leaves the others', () => {
  const p = project()
  decidedCard(p, 'A')
  decidedCard(p, 'B', { dependsOn: ['A'] })
  decidedCard(p, 'C', { dependsOn: ['A'] })
  ok(p, ['reopen', 'A', '--reason', 'rejected', '--why', 'wrong store'])
  const before = stale(p)
  expect(before).toMatch(/^stale\s+#B\b/m)
  expect(before).toMatch(/^stale\s+#C\b/m)

  ok(p, ['rederive', 'B', 'confirm', '--why', 'B still holds'])
  const out = stale(p)
  expect(out).not.toContain('#B')
  expect(out).toMatch(/^stale\s+#C\b/m)
  expect(out).toMatch(/^\s+rejected #A \(event \d+\), along depends_on: wrong store$/m)
  expect(mark(p, 'B')).toBeUndefined()
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', () => {
  const p = project()
  decidedCard(p, 'A')
  decidedCard(p, 'B', { dependsOn: ['A'] })
  decidedCard(p, 'C', { dependsOn: ['B'] })
  const cStatus = node(p, 'C')?.status
  ok(p, ['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  expect(mark(p, 'B')).toBe('paused')
  expect(mark(p, 'C')).toBe('paused')

  ok(p, ['status', 'A', 'decided'])
  expect(mark(p, 'B')).toBeUndefined()
  expect(mark(p, 'C')).toBeUndefined()
  const out = stale(p)
  expect(out).not.toContain('#B')
  expect(out).not.toContain('#C')
  expect(node(p, 'C')?.status).toBe(cStatus)
})
