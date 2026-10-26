import { expect, test } from 'bun:test'
import { events, fresh, ok, p, printedCommands, refuses, runPrinted, show } from './util.ts'

/** A real decided card `base`, so other cards can stand on it. */
const decidedBase = () => {
  ok(['add', 'base', '--title', 'Base', '--who', 'me'])
  ok(['accept', 'base', '--actor', 'you'])
  ok(['edit', 'base', '--no-basis', 'the root of the map'])
  ok(['kill', 'base', '--form', 'revisit'])
  ok(['status', 'base', 'decided'])
}

/** Fills placeholders the way an agent would: a card id for <card-it-needs>, words for any other <...>. */
const fill = (line: string) => line.replace('<card-it-needs>', 'base').replace(/<[^>]*>/g, 'checked by use for a week')

const statusEvents = (id: string) => events().filter((e) => e.payload?.id === id && (e.type === 'node.status_set' || e.type === 'node.reopened'))

/** An open real card `a` with a decider, a depends_on edge to base, and a rejected option. */
const weighedCard = () => {
  decidedBase()
  ok(['add', 'a', '--title', 'Use a log', '--who', 'me', '--body', 'Old words.'])
  ok(['accept', 'a', '--actor', 'you'])
  ok(['link', 'a', 'base', '--type', 'depends_on', '--why', 'takes the base'])
  ok(['add', 'a-opt', '--kind', 'option', '--title', 'Use a table', '--why-not', 'it loses history'])
  ok(['link', 'a-opt', 'a', '--type', 'alternative_to'])
}

// 64.1
// Scenario: A card that lacks a kill criterion stays open, and the printed command fixes it
// Given a map with an open card that has a decider, a depends_on edge, and a rejected option
// But the card has no kill criterion
// When an agent sets the card to decided
// Then the command exits with a failure
// And the output names the kill criterion as the missing fact
// And the output prints the exact command that adds a kill criterion to that card
// And the card still shows as open on the map
// And the log has no new status event for the card
// When the agent runs the printed command
// And the agent sets the card to decided again
// Then the command succeeds
// And the card shows as decided on the map
test('64.1', () => {
  fresh()
  weighedCard()
  expect(show('a').stdout).toContain('status: open')
  const before = statusEvents('a')
  const r = refuses(['status', 'a', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toContain('kill criterion')
  const cmds = printedCommands(out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toStartWith('werk kill a ')
  expect(show('a').stdout).toContain('status: open')
  expect(statusEvents('a')).toEqual(before)

  runPrinted(fill(cmds[0]!))
  ok(['status', 'a', 'decided'])
  expect(show('a').stdout).toContain('status: decided')
})

// 64.2
// Scenario: A card that lacks several facts reports each missing fact with its own command
// Given a map with an open card that has only a title and body text
// When an agent sets the card to decided
// Then the command exits with a failure
// And the output names the missing decider, the missing depends_on basis, the missing rejected option, and the missing kill criterion
// And the output prints a command to fix each missing fact
// And the card still shows as open on the map
// When the agent runs each printed command in turn
// And the agent sets the card to decided again
// Then the card shows as decided on the map
test('64.2', () => {
  fresh()
  decidedBase()
  ok(['add', 'a', '--title', 'Use a log', '--body', 'Some words.'])
  expect(show('a').stdout).toContain('status: open')
  const r = refuses(['status', 'a', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toContain('4 facts are missing')
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toContain(`  ${fact}: `)
  expect(out).toContain('depends_on')
  expect(out).toContain('kill criterion')
  const cmds = printedCommands(out)
  expect(cmds.map((c) => c.split(' ')[1])).toEqual(['edit', 'link', 'add', 'kill'])
  expect(show('a').stdout).toContain('status: open')

  for (const c of cmds) runPrinted(fill(c))
  ok(['status', 'a', 'decided'])
  expect(show('a').stdout).toContain('status: decided')
})

// 64.3
// Scenario: A ghost card obeys the same check through its held edges
// Given a proposed ghost card whose held edges give a decider, a depends_on basis, a rejected option, and a kill criterion
// And a second proposed ghost card whose held edges give no depends_on basis
// When an agent sets the first ghost to decided
// Then the command succeeds
// And the first ghost shows as decided
// When the agent sets the second ghost to decided
// Then the command exits with a failure
// And the output names the missing depends_on basis and prints the command that adds it
// And the second ghost does not show as decided
test('64.3', () => {
  fresh()
  decidedBase()
  // A ghost basis card, decided, so the held depends_on edge has a decided target.
  ok(['add', 'basis', '--title', 'Basis', '--who', 'me'])
  ok(['edit', 'basis', '--no-basis', 'a root'])
  ok(['kill', 'basis', '--form', 'revisit'])
  ok(['status', 'basis', 'decided'])

  ok(['add', 'g1', '--title', 'First ghost', '--who', 'me'])
  ok(['link', 'g1', 'basis', '--type', 'depends_on', '--why', 'takes the basis'])
  ok(['add', 'g1-opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'it costs more'])
  ok(['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(['kill', 'g1', '--form', 'manual', '--text', 'use it for a week'])
  expect(show('g1').stdout).toContain('link: depends_on -> #basis (held)')

  ok(['add', 'g2', '--title', 'Second ghost', '--who', 'me'])
  ok(['add', 'g2-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'it is slow'])
  ok(['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(['kill', 'g2', '--form', 'manual', '--text', 'use it for a week'])

  ok(['status', 'g1', 'decided'])
  const s1 = show('g1').stdout
  expect(s1).toContain('state: ghost')
  expect(s1).toContain('status: decided')

  const r = refuses(['status', 'g2', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toContain('basis')
  expect(out).toContain('depends_on')
  const cmds = printedCommands(out)
  expect(cmds.some((c) => c.startsWith('werk link g2 ') && c.includes('--type depends_on'))).toBe(true)
  expect(show('g2').stdout).not.toContain('status: decided')
})

// 64.4
// Scenario: An amend that removes a required fact is refused and the decided card stays the same
// Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
// When an agent amends the card so that it no longer has its depends_on edge
// Then the command exits with a failure
// And the output names the missing depends_on basis and prints the command that adds it
// And the card still shows as decided
// And the card shows the same words and edges that it had before the amend
test('64.4', () => {
  fresh()
  weighedCard()
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
  const before = show('a').stdout

  const r = refuses(['amend', 'a', '--unlink', 'base', '--summary', 'a no longer takes the base'])
  const out = r.stdout + r.stderr
  expect(out).toContain('basis')
  expect(out).toContain('depends_on')
  const cmds = printedCommands(out)
  expect(cmds.some((c) => c.startsWith('werk link a ') && c.includes('--type depends_on'))).toBe(true)
  const after = show('a').stdout
  expect(after).toContain('status: decided')
  expect(after).toBe(before)
})

// 64.5
// Scenario: An amend that keeps every fact succeeds, and card text is not checked
// Given a decided card with a decider, a depends_on edge, a rejected option, and a kill criterion
// When an agent amends the card to replace its body with one short sentence and keeps every fact
// Then the command succeeds
// And the card shows as decided with the new body text
// And the log shows the amend as a reopen and a decide of the card
test('64.5', () => {
  fresh()
  weighedCard()
  ok(['kill', 'a', '--form', 'revisit'])
  ok(['status', 'a', 'decided'])
  const n = statusEvents('a').length

  ok(['amend', 'a', '--body', 'Short.', '--summary', 'a says it shorter'])
  const s = show('a').stdout
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  expect(s).not.toContain('Old words.')
  const added = statusEvents('a').slice(n)
  expect(added.map((e) => e.type)).toEqual(['node.reopened', 'node.status_set'])
  expect(added[1].payload.status).toBe('decided')
})
