/**
 * Reading: a group in the inbox output starts with a line `#<id>  <title>` and holds the
 * indented note lines below it, up to the next group line.
 */
import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const groups = (out: string) => {
  const g = new Map<string, string[]>()
  let cur: string[] | undefined
  for (const line of out.split('\n')) {
    const m = line.match(/^#(\S+)/)
    if (m) g.set(m[1]!, (cur = []))
    else if (cur && line.startsWith(' ')) cur.push(line)
  }
  return g
}
const noteText = (line: string) => line.replace(/^.*?: /, '')

// 68.1
// Scenario: An agent writes a note on a card and sees it on the card
// Given a map that holds a decided card "#werk-chat" with the title "The composer sends a live agent turn"
// When the agent runs the say verb on "#werk-chat" with the text "The reply streams over SSE"
// Then the command exits with success
// And the log holds one new note event that names "#werk-chat"
// When the agent runs the show verb on "#werk-chat"
// Then the output shows the note "The reply streams over SSE"
test('68.1', () => {
  p = project()
  p.card('werk-chat', 'The composer sends a live agent turn')
  p.facts('werk-chat')
  p.decide('werk-chat')
  const before = p.events()

  const r = p.werk(['say', '#werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = p.events().slice(before.length)
  expect(added).toHaveLength(1)
  expect(added[0].type).toMatch(/note/)
  expect(added[0].payload.id).toBe('werk-chat')

  expect(p.ok(['show', '#werk-chat'])).toContain('The reply streams over SSE')
})

// 68.2
// Scenario: An agent reads a whole card thread in order from the inbox
// Given a map that holds a card "#werk-chat"
// And the agent wrote the note "first" on "#werk-chat"
// And the agent then wrote the note "second" on "#werk-chat"
// And the agent then wrote the note "third" on "#werk-chat"
// When the agent runs the inbox verb
// Then the output shows a group for "#werk-chat"
// And that group shows "first", "second", and "third" in that order
test('68.2', () => {
  p = project()
  p.card('werk-chat', 'The composer sends a live agent turn')
  for (const t of ['first', 'second', 'third']) p.ok(['say', '#werk-chat', '--text', t])

  const g = groups(p.ok(['inbox']))
  expect(g.has('werk-chat')).toBe(true)
  expect(g.get('werk-chat')!.map(noteText)).toEqual(['first', 'second', 'third'])
})

// 68.3
// Scenario: The inbox groups notes by card
// Given a map that holds the cards "#werk-chat" and "#visual"
// And the agent wrote the note "chat one" on "#werk-chat"
// And the agent then wrote the note "visual one" on "#visual"
// And the agent then wrote the note "chat two" on "#werk-chat"
// When the agent runs the inbox verb
// Then the group for "#werk-chat" shows "chat one" and then "chat two"
// And the group for "#visual" shows "visual one"
// But the group for "#visual" does not show "chat one" or "chat two"
test('68.3', () => {
  p = project()
  p.card('werk-chat', 'The composer sends a live agent turn')
  p.card('visual', 'The visual map')
  p.ok(['say', '#werk-chat', '--text', 'chat one'])
  p.ok(['say', '#visual', '--text', 'visual one'])
  p.ok(['say', '#werk-chat', '--text', 'chat two'])

  const g = groups(p.ok(['inbox']))
  expect(g.get('werk-chat')?.map(noteText)).toEqual(['chat one', 'chat two'])
  const visual = g.get('visual')?.map(noteText) ?? []
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

// 68.4
// Scenario: An agent writes a note on a ghost card
// Given a map where the card "#visual" links to "#werk-pane"
// And "#werk-pane" is a ghost with no body
// When the agent runs the say verb on "#werk-pane" with the text "Describe the pane here"
// Then the command exits with success
// When the agent runs the inbox verb
// Then the output shows a group for "#werk-pane" with the note "Describe the pane here"
test('68.4', () => {
  p = project()
  p.card('visual', 'The visual map')
  p.ok(['add', 'werk-pane', '--title', 'The werk pane'])
  p.ok(['link', 'visual', 'werk-pane', '--type', 'depends_on', '--why', 'the map shows the pane'])
  const pane = p.ok(['show', 'werk-pane'])
  expect(pane).toMatch(/^state: ghost/m)
  expect(pane).not.toMatch(/^body:/m)

  const r = p.werk(['say', '#werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)

  const g = groups(p.ok(['inbox']))
  expect(g.get('werk-pane')?.map(noteText)).toContain('Describe the pane here')
})

// 68.5
// Scenario: A note on an unknown card fails and changes nothing
// Given a map that holds a card "#werk-chat"
// And the agent notes the current size of the log
// When the agent runs the say verb on "#no-such-card" with the text "lost note"
// Then the command exits with a non-zero status
// And the output names "#no-such-card" as unknown
// And the log has the same size as before
// When the agent runs the inbox verb
// Then the output does not show "lost note"
test('68.5', () => {
  p = project()
  p.card('werk-chat', 'The composer sends a live agent turn')
  const before = p.logText()

  const r = p.werk(['say', '#no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('no-such-card')
  expect(out).toMatch(/unknown|no node|no card|not found/i)
  expect(p.logText().length).toBe(before.length)

  expect(p.ok(['inbox'])).not.toContain('lost note')
})
