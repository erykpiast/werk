/**
 * Given note: a "recorded session" is a transcript file written by the test under the fake
 * HOME's ~/.claude/projects/<dir>/<session>.jsonl. No CLI path makes one. The message index is
 * the line number from zero in that file (src/map/transcript.ts).
 * Reading: "the map shows an excerpt as a ghost" = `werk show <excerpt>` prints a ghost state;
 * "no new excerpt" = no node of kind excerpt is proposed in the log.
 */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { assistantLine, project, userLine, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const SESSION = '0a1b2c3d-0000-4000-8000-00000000abcd'
const summary = { type: 'summary', summary: 'a recorded session', leafUuid: 'x' }
const excerpts = () => p.events().filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')

// 67.1
// Scenario: A quote found once in a transcript becomes a ghost excerpt on the citing card
// Given a map with a card "#werk-excerpt"
// And a recorded session whose transcript has a user message "Every quote in the imported map was written from memory" at a known message index
// When the person asks werk to quote "written from memory" from that session for the card "#werk-excerpt"
// Then the command succeeds
// And the map shows a new excerpt as a ghost
// And the excerpt shows the session, the message index of that user message, the speaker "user", and the start and end of the quoted text inside that message
// And the card "#werk-excerpt" shows the excerpt as supported_by evidence
test('67.1', () => {
  p = project()
  p.card('werk-excerpt', 'Excerpts')
  const message = 'Every quote in the imported map was written from memory'
  p.transcript(SESSION, [summary, assistantLine(SESSION, 'How should the import work?'), userLine(SESSION, message)])
  const index = 2
  const start = message.indexOf('written from memory')
  const end = start + 'written from memory'.length

  const r = p.werk(['quote', '#werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)

  const ex = excerpts()
  expect(ex).toHaveLength(1)
  const id = ex[0].payload.id as string
  const show = p.ok(['show', id])
  expect(show).toMatch(/^state: ghost/m)
  expect(show).toContain(`quote: session ${SESSION}, message ${index}, characters ${start}-${end}, said by user`)
  expect(p.ok(['show', 'werk-excerpt'])).toMatch(new RegExp(`^supported-by: .*#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'))
})

// 67.2
// Scenario: The excerpt lets the person find the quote again in the transcript
// Given a card "#werk-excerpt" with an excerpt quoted from an assistant message in a recorded session
// When the person opens the excerpt
// And the person goes to the session, message index and span that the excerpt records
// Then the text at that span is the quoted text, character for character
// And the speaker of that message is "assistant", the same as the excerpt shows
test('67.2', () => {
  p = project()
  p.card('werk-excerpt', 'Excerpts')
  const quoted = 'the pointer names the message and the span'
  const path = p.transcript(SESSION, [
    summary,
    userLine(SESSION, 'How does a person find a quote again?'),
    assistantLine(SESSION, `An excerpt keeps a pointer: ${quoted}, so a reader can check it.`),
    userLine(SESSION, 'Good.'),
  ])
  p.ok(['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const id = excerpts()[0].payload.id as string

  const show = p.ok(['show', id])
  const m = show.match(/^quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)$/m)
  expect(m).not.toBeNull()
  const [, session, msg, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(msg)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

// 67.3
// Scenario: A quote with one changed character fails and changes nothing
// Given a recorded session whose transcript contains "the tool never guesses"
// And the person notes the current event count of the map
// When the person asks werk to quote "the tool never gueses" from that session for an existing card
// Then the command exits with a non-zero status
// And the error says that the text has no exact match in the session
// And the event log has the same number of events as before
// And the map shows no new excerpt
test('67.3', () => {
  p = project()
  p.card('werk-excerpt', 'Excerpts')
  p.transcript(SESSION, [summary, userLine(SESSION, 'Make sure the tool never guesses a quote.')])
  const before = p.events().length

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(p.events().length).toBe(before)
  expect(excerpts()).toHaveLength(0)
})

// 67.4
// Scenario: A quote that occurs in two messages fails and names both messages
// Given a recorded session where the text "fails instead of guessing" occurs in message 3 and in message 7
// When the person asks werk to quote "fails instead of guessing" from that session for an existing card
// Then the command exits with a non-zero status
// And the error names message 3 and message 7
// And the event log has no new event
// And the map shows no new excerpt
test('67.4', () => {
  p = project()
  p.card('werk-excerpt', 'Excerpts')
  const q = 'fails instead of guessing'
  p.transcript(SESSION, [
    summary, // 0
    userLine(SESSION, 'Start.'), // 1
    assistantLine(SESSION, 'One.'), // 2
    userLine(SESSION, `A quote that is not unique ${q}.`), // 3
    assistantLine(SESSION, 'Two.'), // 4
    userLine(SESSION, 'Three.'), // 5
    assistantLine(SESSION, 'Four.'), // 6
    assistantLine(SESSION, `Yes, the reader ${q} every time.`), // 7
  ])
  const before = p.logText()

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', q])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(r.stderr).toContain('messages: 3, 7')
  expect(p.logText()).toBe(before)
  expect(excerpts()).toHaveLength(0)
})

// 67.5
// Scenario: A ghost excerpt is accepted the same way as every other ghost
// Given a card with a ghost excerpt that werk quoted from a recorded session
// When the person accepts the ghost excerpt
// Then the excerpt shows as a normal node and no longer as a ghost
// And the card still shows the excerpt as supported_by evidence
test('67.5', () => {
  p = project()
  p.card('werk-excerpt', 'Excerpts')
  p.transcript(SESSION, [summary, userLine(SESSION, 'Every quote in the imported map was written from memory')])
  p.ok(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  const id = excerpts()[0].payload.id as string
  expect(p.ok(['show', id])).toMatch(/^state: ghost/m)

  p.ok(['accept', id, '--actor', 'you'])

  const show = p.ok(['show', id])
  expect(show).toMatch(/^state: real$/m)
  expect(show).not.toContain('ghost')
  expect(p.ok(['show', 'werk-excerpt'])).toMatch(/^supported-by: .*#werk-excerpt:ex0/m)
  expect(id).toBe('werk-excerpt:ex0')
})
