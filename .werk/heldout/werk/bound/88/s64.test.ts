/** Held-out steps 64.1-64.5 and 65.1-65.5, bound to the werk command line. */
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { graphOf } from '../src/map/graph.ts'
import { readLog } from '../src/map/log.ts'

let p: Project
afterEach(() => p?.cleanup())

const logPathOf = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => (existsSync(logPathOf()) ? readFileSync(logPathOf(), 'utf8').split('\n').filter(Boolean) : [])

const ok = (args: string[]) => {
  const r = p.werk(args)
  expect({ args, ...r }).toMatchObject({ code: 0, stderr: '' })
  return r
}
const fails = (args: string[]) => {
  const r = p.werk(args)
  expect(r.code).not.toBe(0)
  return r
}
const printed = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('    werk '))
    .map((l) => l.trim())
const runPrinted = (line: string) => {
  for (const command of line.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('werk')
    ok(words.slice(1))
  }
}
const show = (id: string) => p.werk(['show', id]).stdout
const statusOf = (id: string) => /status: (\S+)/.exec(show(id))?.[1]
/** The map data the server sends (GET /api/graph), from the same function. */
const marks = () => graphOf(readLog(logPathOf())).marks
const statusEvents = (id: string) =>
  logLines()
    .map((l) => JSON.parse(l) as { type: string; payload: { id?: string } })
    .filter((e) => e.payload.id === id && (e.type === 'node.status_set' || e.type === 'node.reopened'))

const decidedBase = () => {
  ok(['add', 'base', '--title', 'Base', '--who', 'me'])
  ok(['accept', 'base', '--actor', 'you'])
  ok(['edit', 'base', '--no-basis', 'the root of the map'])
  ok(['kill', 'base', '--form', 'revisit'])
  ok(['status', 'base', 'decided'])
}

/** Real card `id` with decider, a depends_on edge to `on`, a rejected option. No kill. */
const weighed = (id: string, on: string) => {
  ok(['add', id, '--title', `Card ${id}`, '--who', 'me', '--body', 'Old words.'])
  ok(['accept', id, '--actor', 'you'])
  ok(['link', id, on, '--type', 'depends_on', '--why', `takes ${on}`])
  ok(['add', `${id}:opt0`, '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(['link', `${id}:opt0`, id, '--type', 'alternative_to'])
}

/** Real decided card; depends on `on` if given, else has a no-basis reason. */
const decided = (id: string, on?: string) => {
  ok(['add', id, '--title', `Card ${id}`, '--who', 'me'])
  ok(['accept', id, '--actor', 'you'])
  if (on) ok(['link', id, on, '--type', 'depends_on', '--why', `takes ${on}`])
  else ok(['edit', id, '--no-basis', 'a root card'])
  ok(['kill', id, '--form', 'revisit'])
  ok(['status', id, 'decided'])
}

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  decidedBase()
  weighed('a', 'base')
  ok(['status', 'a', 'open'])
  const before = statusEvents('a')
  const r = fails(['status', 'a', 'decided'])
  expect(r.code).toBe(1)
  const out = r.stdout + r.stderr
  expect(out).toContain('kill')
  expect(out).toContain('no kill criterion')
  const cmds = printed(out)
  expect(cmds).toEqual(['werk kill a --form manual --text "<what you check by use to revisit a>"'])
  expect(statusOf('a')).toBe('open')
  expect(statusEvents('a')).toEqual(before)
  runPrinted(cmds[0]!)
  ok(['status', 'a', 'decided'])
  expect(statusOf('a')).toBe('decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  decidedBase()
  ok(['add', 'a', '--title', 'A', '--body', 'Some words.', '--status', 'open'])
  ok(['accept', 'a', '--actor', 'you'])
  const r = fails(['status', 'a', 'decided'])
  expect(r.code).toBe(1)
  const out = r.stdout + r.stderr
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toContain(`  ${fact}: `)
  expect(out).toContain('depends_on')
  const cmds = printed(out)
  expect(cmds.length).toBe(4)
  expect(cmds.map((c) => c.split(' ')[1])).toEqual(['edit', 'link', 'add', 'kill'])
  expect(statusOf('a')).toBe('open')
  for (const c of cmds) runPrinted(c.replace('<card-it-needs>', 'base'))
  ok(['status', 'a', 'decided'])
  expect(statusOf('a')).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  decidedBase()
  // First ghost: decider, held depends_on to a decided card, held rejected option, kill.
  ok(['add', 'g', '--title', 'G', '--who', 'me'])
  ok(['link', 'g', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(['add', 'g:opt0', '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(['link', 'g:opt0', 'g', '--type', 'alternative_to'])
  ok(['kill', 'g', '--form', 'manual', '--text', 'use it for a week'])
  // Second ghost: no depends_on basis.
  ok(['add', 'h', '--title', 'H', '--who', 'me'])
  ok(['add', 'h:opt0', '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(['link', 'h:opt0', 'h', '--type', 'alternative_to'])
  ok(['kill', 'h', '--form', 'manual', '--text', 'use it for a week'])
  expect(show('g')).toContain('state: ghost')
  expect(show('h')).toContain('state: ghost')

  ok(['status', 'g', 'decided'])
  expect(statusOf('g')).toBe('decided')
  expect(show('g')).toContain('state: ghost')

  const r = fails(['status', 'h', 'decided'])
  expect(r.code).toBe(1)
  const out = r.stdout + r.stderr
  expect(out).toContain('  basis: ')
  expect(out).toContain('depends_on')
  expect(printed(out)).toEqual(['werk link h <card-it-needs> --type depends_on --why "<what h takes from it>"'])
  expect(statusOf('h')).not.toBe('decided')
})

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  decidedBase()
  weighed('a', 'base')
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
  const shownBefore = show('a')
  const logBefore = logLines()
  const r = fails(['amend', 'a', '--unlink', 'base', '--summary', 'a no longer takes the base'])
  expect(r.code).toBe(1)
  const out = r.stdout + r.stderr
  expect(out).toContain('  basis: ')
  expect(out).toContain('depends_on')
  expect(printed(out)).toEqual(['werk link a <card-it-needs> --type depends_on --why "<what a takes from it>"'])
  expect(statusOf('a')).toBe('decided')
  expect(show('a')).toBe(shownBefore)
  expect(shownBefore).toContain('depends_on -> #base')
  expect(logLines()).toEqual(logBefore)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  decidedBase()
  weighed('a', 'base')
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
  const before = statusEvents('a').length
  ok(['amend', 'a', '--body', 'Short.', '--summary', 'a says it shorter'])
  const shown = show('a')
  expect(statusOf('a')).toBe('decided')
  expect(shown).toContain('Short.')
  expect(shown).not.toContain('Old words.')
  expect(statusEvents('a').slice(before).map((e) => e.type)).toEqual(['node.reopened', 'node.status_set'])
  const decideEvent = statusEvents('a').at(-1) as unknown as { payload: { status: string } }
  expect(decideEvent.payload.status).toBe('decided')
})

test('65.1 a rejected reopen marks only the next hop as stale', () => {
  p = makeProject()
  decided('A')
  decided('B', 'A')
  decided('C', 'B')
  ok(['reopen', 'A', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = ok(['stale']).stdout
  expect(out).toMatch(/^stale\s+#B\b/m)
  const entry = out.slice(out.indexOf('#B'))
  expect(entry).toMatch(/^\s+rejected #A .*along depends_on/m)
  expect(out).not.toContain('#C')
  const m = marks()
  expect(m.B?.mark).toBe('stale')
  expect(m.C).toBeUndefined()
})

test('65.2 a postponed reopen pauses every downstream card and keeps their status', () => {
  p = makeProject()
  decided('A')
  decided('B', 'A')
  decided('C', 'B')
  decided('D', 'C')
  ok(['reopen', 'A', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const m = marks()
  for (const id of ['B', 'C', 'D']) expect(m[id]?.mark).toBe('paused')
  expect(statusOf('D')).toBe('decided')
  const out = ok(['stale']).stdout
  expect(out).toMatch(/^paused\s+#D\b/m)
  const entry = out.slice(out.indexOf('#D'))
  expect(entry).toMatch(/^\s+postponed #A /m)
  expect(Object.values(m).some((x) => x.mark === 'stale')).toBe(false)
  expect(out).not.toMatch(/^stale /m)
})

test('65.3 stale wins when a postponement and a rejection reach the same card', () => {
  p = makeProject()
  decided('A')
  decided('B')
  ok(['add', 'C', '--title', 'Card C', '--who', 'me', '--parent', 'B'])
  ok(['accept', 'C', '--actor', 'you'])
  ok(['link', 'C', 'A', '--type', 'depends_on', '--why', 'takes A'])
  ok(['kill', 'C', '--form', 'revisit'])
  ok(['status', 'C', 'decided'])
  ok(['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  ok(['reopen', 'B', '--reason', 'rejected', '--why', 'wrong'])
  expect(marks().C?.mark).toBe('stale')
  const out = ok(['stale']).stdout
  expect(out).toMatch(/^stale\s+#C\b/m)
  expect(out).not.toMatch(/^paused\s+#C\b/m)
  const entry = out.slice(out.indexOf('#C'))
  expect(entry).toMatch(/^\s+rejected #B /m)
})

test('65.4 rederive clears the mark on one card and leaves the others', () => {
  p = makeProject()
  decided('A')
  decided('B', 'A')
  decided('C', 'A')
  ok(['reopen', 'A', '--reason', 'rejected', '--why', 'wrong'])
  let out = ok(['stale']).stdout
  expect(out).toMatch(/^stale\s+#B\b/m)
  expect(out).toMatch(/^stale\s+#C\b/m)
  ok(['rederive', 'B', 'confirm', '--why', 'B holds without A'])
  out = ok(['stale']).stdout
  expect(out).not.toContain('#B')
  expect(out).toMatch(/^stale\s+#C\b/m)
  expect(out.slice(out.indexOf('#C'))).toMatch(/^\s+rejected #A /m)
  const m = marks()
  expect(m.B).toBeUndefined()
  expect(m.C?.mark).toBe('stale')
})

test('65.5 deciding a postponed card again clears the paused marks downstream', () => {
  p = makeProject()
  decided('A')
  decided('B', 'A')
  decided('C', 'B')
  const cBefore = statusOf('C')
  ok(['reopen', 'A', '--reason', 'postponed', '--why', 'later'])
  expect(marks().B?.mark).toBe('paused')
  expect(marks().C?.mark).toBe('paused')
  ok(['status', 'A', 'decided'])
  const m = marks()
  expect(m.B).toBeUndefined()
  expect(m.C).toBeUndefined()
  const out = ok(['stale']).stdout
  expect(out).not.toContain('#B')
  expect(out).not.toContain('#C')
  expect(statusOf('C')).toBe(cBefore)
})
