import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { copyTickets, projectWith, readTicket, ticketCheck, writeTicket } from './util.ts'

let p: Project | undefined
afterEach(() => p?.cleanup())

/**
 * The map: the root "map" is a real open card, so the decided cards of its subtree are exactly
 * "map-reopen" and "map-stale". The ticket check reads them with --root map.
 */
const mapSubtree = () => [
  proposed('map', { status: 'open' }),
  proposed('map-reopen', { status: 'decided', parent: 'map' }),
  proposed('map-stale', { status: 'decided', parent: 'map' }),
  accepted('map'),
  accepted('map-reopen'),
  accepted('map-stale'),
]

const lines = (s: string) => s.trimEnd().split('\n')

// 80.1
// Scenario: A folder of valid tickets passes the ticket check
// Given a map with a subtree whose decided cards are "map-reopen" and "map-stale"
// And a spec for that subtree with stories 1, 2 and 3
// And a folder with two ticket files that each have the five header lines and the three sections in order
// And ticket 1 cites "map-reopen", lists stories 1 and 2, and touches "map view"
// And ticket 2 cites "map-stale", is blocked by ticket 1, lists story 3, and touches "decision log"
// When the person runs the ticket check on the folder, with the subtree root and the spec
// Then the output shows no failure
// And the command exits with code zero
test('80.1', () => {
  p = projectWith(mapSubtree())
  copyTickets(p, 'f80-1', 'spec3.md')
  const r = ticketCheck(p)
  console.log('80.1 output:\n' + r.stdout + r.stderr)
  expect(r.stderr).toBe('')
  // Only the summary line, with 0 failures.
  expect(lines(r.stdout)).toHaveLength(1)
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.stdout).toContain('2 decided card(s) and 3 story(ies)')
  expect(r.code).toBe(0)
})

// 80.2
// Scenario: A ticket with a missing touches line and a path in its body fails its own checks by name
// Given a map subtree, a spec, and a folder of tickets that pass every check together
// When the person deletes the touches line from ticket 2
// And the person adds the text "edit src/loop.ts" to the What to build section of ticket 3
// And the person changes the touches line of ticket 1 to "map view, server/routes"
// And the person runs the ticket check on the folder, with the subtree root and the spec
// Then the output names ticket 2 with the shape check and the touches field
// And the output names ticket 3 with the no-file-paths check, the path "src/loop.ts" and its line number
// And the output names ticket 1 with the touches check
// And the command exits with a non-zero code
test('80.2', () => {
  p = projectWith(mapSubtree())
  copyTickets(p, 'f80-2', 'spec3.md')
  const given = ticketCheck(p)
  expect(given.code).toBe(0) // the Given: the set passes every check together

  writeTicket(p, '02-stale.md', readTicket(p, '02-stale.md').replace(/^touches:.*\n/m, ''))
  // Add the text as a new line right after the What to build heading's blank line.
  const t3 = readTicket(p, '03-name.md').split('\n')
  const at = t3.indexOf('## What to build') + 2
  t3.splice(at, 0, 'edit src/loop.ts')
  writeTicket(p, '03-name.md', t3.join('\n'))
  const lineNo = at + 1
  writeTicket(p, '01-reopen.md', readTicket(p, '01-reopen.md').replace(/^touches:.*$/m, 'touches: map view, server/routes'))

  const r = ticketCheck(p)
  console.log('80.2 output:\n' + r.stdout + r.stderr)
  const out = lines(r.stdout)
  expect(out.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(out.some((l) => l.startsWith('03-name.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${lineNo}`))).toBe(true)
  expect(out.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

// 80.3
// Scenario: A ticket that fails its own checks does not count in the set checks
// Given a map subtree with the decided card "map-stale", which only ticket 2 cites
// And a spec in which only ticket 2 lists story 3
// And ticket 4 is blocked by ticket 2
// When the person removes the What to build heading from ticket 2
// And the person runs the ticket check on the folder, with the subtree root and the spec
// Then the output names ticket 2 with the shape check and the missing What to build heading
// And the output reports "map-stale" as a card that no ticket cites
// And the output reports story 3 as a story that no ticket delivers
// And the output names ticket 4 for a blocker that is not in the set
// And the command exits with a non-zero code
test('80.3', () => {
  p = projectWith(mapSubtree())
  copyTickets(p, 'f80-3', 'spec3.md')
  expect(ticketCheck(p).code).toBe(0) // the folder passes before the change
  writeTicket(p, '02-stale.md', readTicket(p, '02-stale.md').replace(/^## What to build\n/m, ''))

  const r = ticketCheck(p)
  console.log('80.3 output:\n' + r.stdout + r.stderr)
  const out = lines(r.stdout)
  expect(out.some((l) => l.startsWith('02-stale.md: shape: What to build:') && l.includes('## What to build'))).toBe(true)
  expect(out.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-stale'))).toBe(true)
  expect(out.some((l) => l.startsWith('ticket set: stories:') && l.includes('no ticket delivers story 3'))).toBe(true)
  expect(out.some((l) => l.startsWith('04-log.md: blocked_by:') && l.includes('blocker 2 is not a ticket in the set'))).toBe(true)
  expect(r.code).not.toBe(0)
})

// 80.4
// Scenario: A ticket set with coverage and order errors names each card, story and ticket
// Given a map subtree whose decided cards include "map-reopen", which no ticket cites
// And a spec with stories 1 to 4, where no ticket lists story 4
// And ticket 1 lists story 9, which is not in the spec
// And ticket 2 is blocked by ticket 3, and ticket 3 is blocked by ticket 2
// And ticket 5 is blocked by ticket 8, which is not in the folder
// And ticket 1 and ticket 4 are on no cycle and name no unknown blocker
// When the person runs the ticket check on the folder, with the subtree root and the spec
// Then the output reports "map-reopen" as an uncited card
// And the output reports story 4 as missing and story 9 as unknown
// And the output names tickets 2 and 3 for the cycle and ticket 5 for the unknown blocker
// But the output names neither ticket 1 nor ticket 4 under the blocked_by check
// And the command exits with a non-zero code
test('80.4', () => {
  p = projectWith(mapSubtree())
  copyTickets(p, 'f80-4', 'spec4.md')
  const r = ticketCheck(p)
  console.log('80.4 output:\n' + r.stdout + r.stderr)
  const out = lines(r.stdout)
  expect(out.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-reopen'))).toBe(true)
  expect(out.some((l) => l.startsWith('ticket set: stories:') && /story 4\b/.test(l) && l.includes('no ticket delivers'))).toBe(true)
  expect(out.some((l) => l.startsWith('ticket set: stories:') && /story 9\b/.test(l) && l.includes('spec has no story 9'))).toBe(true)
  expect(out.some((l) => l.startsWith('02-stale.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(out.some((l) => l.startsWith('03-name.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(out.some((l) => l.startsWith('05-after.md: blocked_by:') && l.includes('blocker 8'))).toBe(true)
  expect(out.filter((l) => /^0[14]-[^:]*: blocked_by:/.test(l))).toEqual([])
  expect(r.code).not.toBe(0)
})

// 80.5
// Scenario: An agent fixes a ticket on request and the next ticket check passes
// Given a folder of tickets where the ticket check fails only because no ticket lists story 3
// When an agent changes ticket 2 to list story 3, on the person's request
// And the agent runs the ticket check again on the same folder, subtree root and spec
// Then the output shows no failure
// And the command exits with code zero
// Reading: the agent is the harness's fake `claude`, launched with the person's request as its
// prompt; its script edits ticket 2. The fake agent cannot run commands, so the test runs the
// same `werk ticket-check` call the agent would run, in the same project.
test('80.5', () => {
  p = projectWith(mapSubtree())
  copyTickets(p, 'f80-5', 'spec3.md')
  const before = ticketCheck(p)
  console.log('80.5 before:\n' + before.stdout)
  expect(before.code).not.toBe(0)
  expect(lines(before.stdout).slice(0, -1)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])

  const fixed = readTicket(p, '02-stale.md').replace(/^stories:.*$/m, 'stories: 3')
  p.scriptAgent({ steps: [{ edit: { path: 'tickets/02-stale.md', content: fixed } }] })
  const agent = p.run(['claude', '-p', 'Please change ticket 2 to list story 3, then run the ticket check again.'])
  expect(agent.code).toBe(0)

  const r = ticketCheck(p)
  console.log('80.5 after:\n' + r.stdout + r.stderr)
  expect(lines(r.stdout)).toHaveLength(1)
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})
