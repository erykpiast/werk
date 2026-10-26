import { afterEach, expect, test } from 'bun:test'
import { ctx, decidedCard, fresh, logEvents, logLines, ok, printedCommands, realCard, runPrinted, show, werk } from './helpers.ts'

afterEach(() => ctx.p?.cleanup())

const statusEventsOf = (id: string) => logEvents().filter((e) => e.payload?.id === id && (e.type === 'node.status_set' || e.type === 'node.reopened'))

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  fresh()
  decidedCard('base', 'Base')
  realCard('a', 'A', ['--status', 'open'])
  ok(['edit', 'a', '--who', 'you'])
  ok(['link', 'a', 'base', '--type', 'depends_on', '--why', 'a takes base'])
  ok(['add', 'a-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'costs more'])
  ok(['link', 'a-opt', 'a', '--type', 'alternative_to'])
  ok(['accept', 'a-opt', '--actor', 'you'])
  const statusBefore = statusEventsOf('a')
  const before = logLines()

  const r = werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]!.startsWith('werk kill a ')).toBe(true)
  expect(show('a')).toContain('status: open')
  expect(logLines()).toEqual(before)
  expect(statusEventsOf('a')).toEqual(statusBefore)

  runPrinted(cmds[0]!)
  const r2 = werk(['status', 'a', 'decided'])
  expect(r2.code).toBe(0)
  expect(show('a')).toContain('status: decided')
})

test('64.2 a card that lacks several facts reports each with its own command', () => {
  fresh()
  decidedCard('base', 'Base')
  realCard('a', 'A', ['--body', 'Some body text.', '--status', 'open'])

  const r = werk(['status', 'a', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  for (const fact of ['who:', 'basis:', 'options:', 'kill:']) expect(out).toContain(`  ${fact}`)
  expect(out).toMatch(/depends_on/)
  expect(out).toMatch(/option/)
  expect(out).toMatch(/kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(4)
  expect(show('a')).toContain('status: open')

  // The basis command holds the placeholder <card-it-needs>; it is replaced with a real decided card.
  for (const c of cmds) runPrinted(c.replace('<card-it-needs>', 'base'))
  expect(werk(['status', 'a', 'decided']).code).toBe(0)
  expect(show('a')).toContain('status: decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  fresh()
  decidedCard('base', 'Base')
  ok(['add', 'g1', '--title', 'G1', '--who', 'you'])
  ok(['link', 'g1', 'base', '--type', 'depends_on', '--why', 'g1 takes base'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'slower'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'revisit'])
  ok(['add', 'g2', '--title', 'G2', '--who', 'you'])
  ok(['add', 'g2-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'slower'])
  ok(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'revisit'])

  expect(werk(['status', 'g1', 'decided']).code).toBe(0)
  const s1 = show('g1')
  expect(s1).toContain('state: ghost')
  expect(s1).toContain('status: decided')

  const before = logLines()
  const r = werk(['status', 'g2', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('basis:')
  expect(out).toMatch(/depends_on/)
  expect(printedCommands(out).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on'))).toBe(true)
  expect(logLines()).toEqual(before)
  expect(show('g2')).not.toContain('status: decided')
})

const decidedWithFacts = () => {
  decidedCard('base', 'Base')
  realCard('a', 'A', ['--body', 'The long first body of the card.'])
  ok(['edit', 'a', '--who', 'you'])
  ok(['link', 'a', 'base', '--type', 'depends_on', '--why', 'a takes base'])
  ok(['add', 'a-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'costs more'])
  ok(['link', 'a-opt', 'a', '--type', 'alternative_to'])
  ok(['accept', 'a-opt', '--actor', 'you'])
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
}

test('64.4 an amend that removes a required fact is refused and the card stays the same', () => {
  fresh()
  decidedWithFacts()
  const shownBefore = show('a')
  const before = logLines()
  const r = werk(['amend', 'a', '--unlink', 'base', '--summary', 'a drops its basis'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('basis:')
  expect(out).toMatch(/depends_on/)
  expect(printedCommands(out).some((c) => c.startsWith('werk link a ') && c.includes('depends_on'))).toBe(true)
  expect(logLines()).toEqual(before)
  const shownAfter = show('a')
  expect(shownAfter).toContain('status: decided')
  expect(shownAfter).toBe(shownBefore)
})

test('64.5 an amend that keeps every fact succeeds, and text is not checked', () => {
  fresh()
  decidedWithFacts()
  const n = logLines().length
  const r = werk(['amend', 'a', '--body', 'Short.', '--summary', 'shorter body'])
  expect(r.code).toBe(0)
  const s = show('a')
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  const added = logEvents().slice(n).filter((e) => e.payload?.id === 'a').map((e) => e.type)
  expect(added).toContain('node.reopened')
  expect(added.indexOf('node.reopened')).toBeLessThan(added.lastIndexOf('node.status_set'))
  expect(logEvents().slice(n).find((e) => e.type === 'node.status_set')?.payload.status).toBe('decided')
})
