import { expect, test } from 'bun:test'
import { appendsOne, fresh, logLines, ok, refuses, show } from './util.ts'

// 62.1
// Scenario: An agent proposes a card and a person accepts it into the map
// Given a map whose log already holds some events
// When the agent adds a new card with an id, a title, a body and a why from the command line
// Then the command output says "proposed"
// And the log has exactly one more event, at the end, and every earlier line is unchanged
// When the person shows that card from the command line
// Then the output prints its title, body and why, and marks the card as a ghost
// When the agent accepts the card and states that the person asked for it
// Then the command succeeds
// And the log has exactly one more event, at the end, and every earlier line is unchanged
// And showing the card prints the same title, body and why, and marks the card as real, not as a ghost
test('62.1', () => {
  fresh()
  ok(['add', 'other', '--title', 'Other card'])
  ok(['accept', 'other', '--actor', 'you'])
  ok(['say', 'other', '--text', 'a note'])
  expect(logLines().length).toBe(3)

  const add = appendsOne(['add', 'log', '--title', 'Use a log', '--body', 'Every change is one line.', '--why', 'History stays.'])
  expect(add.stdout).toContain('proposed')

  const g = show('log')
  expect(g.code).toBe(0)
  expect(g.stdout).toContain('Use a log')
  expect(g.stdout).toContain('Every change is one line.')
  expect(g.stdout).toContain('History stays.')
  expect(g.stdout).toContain('state: ghost')

  appendsOne(['accept', 'log', '--actor', 'you'])
  const r = show('log').stdout
  expect(r).toContain('Use a log')
  expect(r).toContain('Every change is one line.')
  expect(r).toContain('History stays.')
  expect(r).toContain('state: real')
  expect(r).not.toContain('ghost')
})

// 62.2
// Scenario: An accept without the person's claim refuses and leaves the ghost waiting
// Given the agent has proposed a card from the command line
// When the agent accepts that card without stating that the person asked for it
// Then the command exits with a failure
// And the log has no new event
// And showing the card still marks it as a ghost
// When the agent accepts the card again and states that the person asked for it
// Then showing the card marks it as real
test('62.2', () => {
  fresh()
  ok(['add', 'log', '--title', 'Use a log'])
  refuses(['accept', 'log'])
  expect(show('log').stdout).toContain('state: ghost')
  ok(['accept', 'log', '--actor', 'you'])
  expect(show('log').stdout).toContain('state: real')
})

// 62.3
// Scenario: The words of a ghost are frozen
// Given the agent has proposed a card with the title "Use a log"
// When the agent edits the body of that card
// Then the command exits with a failure and the log has no new event
// When the agent retitles that card to "Use an append-only log"
// Then the command exits with a failure and the log has no new event
// When the agent adds a card again with the same id and a different title
// Then the command exits with a failure and the log has no new event
// And showing the card prints the title "Use a log" and marks it as a ghost
test('62.3', () => {
  fresh()
  ok(['add', 'log', '--title', 'Use a log'])
  refuses(['edit', 'log', '--body', 'A new body.'])
  refuses(['retitle', 'log', '--title', 'Use an append-only log'])
  refuses(['add', 'log', '--title', 'Use a table'])
  const s = show('log').stdout
  expect(s).toContain('#log  Use a log')
  expect(s).toContain('state: ghost')
})

// 62.4
// Scenario: A retitle on a real card shows only the new title and keeps the old one in the log
// Given the agent has proposed a card with the title "Use a log"
// And the card is accepted with the person's claim
// When the agent retitles the card to "Use an append-only log"
// Then the command succeeds and the log has exactly one more event, at the end
// And showing the card prints "Use an append-only log" and does not print "Use a log"
// And the log file still contains the title "Use a log" on its earlier line
// When the agent edits the body of the card
// Then showing the card prints the new body and the title "Use an append-only log"
test('62.4', () => {
  fresh()
  ok(['add', 'log', '--title', 'Use a log'])
  ok(['accept', 'log', '--actor', 'you'])
  const before = logLines()
  appendsOne(['retitle', 'log', '--title', 'Use an append-only log'])
  const s = show('log').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const first = before.findIndex((l) => l.includes('"Use a log"'))
  expect(first).toBeGreaterThanOrEqual(0)
  expect(logLines()[first]).toContain('"Use a log"')

  ok(['edit', 'log', '--body', 'Nothing is deleted.'])
  const s2 = show('log').stdout
  expect(s2).toContain('Nothing is deleted.')
  expect(s2).toContain('Use an append-only log')
})

// 62.5
// Scenario: An option, a source and an excerpt also enter as ghosts
// Given a map with one accepted real card
// When the agent adds an option with a why-not reason under that card
// And the agent adds a source
// And the agent adds an excerpt
// Then each add command says "proposed" and appends exactly one event at the end of the log
// And showing each of the three prints its fields and marks it as a ghost
// When the agent accepts the option with the person's claim
// Then showing the option marks it as real, with its why-not reason unchanged
// And the source and the excerpt still show as ghosts
test('62.5', () => {
  fresh()
  ok(['add', 'card', '--title', 'Storage'])
  ok(['accept', 'card', '--actor', 'you'])

  expect(appendsOne(['add', 'opt', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'needs a server', '--parent', 'card']).stdout).toContain('proposed')
  expect(appendsOne(['add', 'src', '--kind', 'source', '--title', 'Benchmark notes', '--body', 'Numbers from a run.']).stdout).toContain('proposed')
  expect(appendsOne(['add', 'exc', '--kind', 'excerpt', '--title', 'A quote', '--body', 'We want one file.']).stdout).toContain('proposed')

  const o = show('opt').stdout
  expect(o).toContain('Use Postgres')
  expect(o).toContain('why-not: needs a server')
  expect(o).toContain('state: ghost')
  const s = show('src').stdout
  expect(s).toContain('Benchmark notes')
  expect(s).toContain('Numbers from a run.')
  expect(s).toContain('state: ghost')
  const e = show('exc').stdout
  expect(e).toContain('A quote')
  expect(e).toContain('We want one file.')
  expect(e).toContain('state: ghost')

  ok(['accept', 'opt', '--actor', 'you'])
  const o2 = show('opt').stdout
  expect(o2).toContain('state: real')
  expect(o2).toContain('why-not: needs a server')
  expect(show('src').stdout).toContain('state: ghost')
  expect(show('exc').stdout).toContain('state: ghost')
})
