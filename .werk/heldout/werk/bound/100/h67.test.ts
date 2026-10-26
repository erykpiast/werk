import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { card, logLines, mapOf, projectWith, werkOk } from './h65-68-lib.ts'
import type { Project } from '../src/test/harness.ts'

const SESSION = '5cc3d1c4-0000-4000-8000-0000000000aa'
const line = (role: 'user' | 'assistant', text: string) =>
  JSON.stringify({ type: role, sessionId: SESSION, message: { role, content: role === 'user' ? text : [{ type: 'text', text }] } })

/** Records a session transcript where Claude Code keeps it, under the project's HOME. */
function recordSession(p: Project, lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-tmp-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}
const excerpts = async (p: Project) => (await mapOf(p)).nodes.filter((n) => n.kind === 'excerpt')

// Scenario: A quote found once in a transcript becomes a ghost excerpt on the citing card
test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', async () => {
  const p = projectWith(card('werk-excerpt', 'Quote the transcript'))
  // a user message at a known message index (2)
  const userMsg = 'Every quote in the imported map was written from memory'
  recordSession(p, [JSON.stringify({ type: 'summary', summary: 's' }), line('assistant', 'Hello.'), line('user', userMsg), line('assistant', 'Noted.')])
  // When the person asks werk to quote "written from memory" from that session for the card
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  // Then the command succeeds
  expect(r.code).toBe(0)
  // And the map shows a new excerpt as a ghost
  const ex = await excerpts(p)
  expect(ex.length).toBe(1)
  expect(ex[0]!.proposed).toBe(true)
  // And the excerpt shows the session, the message index, the speaker "user", and the start and end
  const start = userMsg.indexOf('written from memory')
  const shown = werkOk(p, ['show', ex[0]!.id])
  expect(shown).toContain(`session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  // And the card shows the excerpt as supported_by evidence
  expect(werkOk(p, ['show', 'werk-excerpt'])).toMatch(new RegExp(`supported-by: .*#${ex[0]!.id}`))
})

// Scenario: The excerpt lets the person find the quote again in the transcript
test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  const p = projectWith(card('werk-excerpt', 'Quote the transcript'))
  const path = recordSession(p, [line('user', 'How do we quote?'), line('assistant', 'We quote the transcript and the tool never guesses at all.')])
  const quoted = 'the tool never guesses'
  werkOk(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  // When the person opens the excerpt
  const shown = werkOk(p, ['show', 'werk-excerpt:ex0'])
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(shown)
  expect(m).not.toBeNull()
  // And the person goes to the session, message index and span
  expect(m![1]).toBe(SESSION)
  const msg = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(m![2])]!) as { message: { role: string; content: { text: string }[] } }
  const text = msg.message.content.map((b) => b.text).join('\n')
  // Then the text at that span is the quoted text
  expect(text.slice(Number(m![3]), Number(m![4]))).toBe(quoted)
  // And the speaker of that message is "assistant", the same as the excerpt shows
  expect(msg.message.role).toBe('assistant')
  expect(m![5]).toBe('assistant')
})

// Scenario: A quote with one changed character fails and changes nothing
test('67.3 a quote with one changed character fails and changes nothing', async () => {
  const p = projectWith(card('werk-excerpt', 'Quote the transcript'))
  recordSession(p, [line('user', 'Promise me that the tool never guesses.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  // And the error says that the text has no exact match in the session
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p).length).toBe(before)
  expect(await excerpts(p)).toEqual([])
})

// Scenario: A quote that occurs in two messages fails and names both messages
test('67.4 a quote that occurs in two messages fails and names both messages', async () => {
  const p = projectWith(card('werk-excerpt', 'Quote the transcript'))
  const t = 'The reader fails instead of guessing.'
  recordSession(p, [line('user', 'm0'), line('assistant', 'm1'), line('user', 'm2'), line('assistant', t), line('user', 'm4'), line('assistant', 'm5'), line('user', 'm6'), line('assistant', t)])
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  // And the error names message 3 and message 7
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(logLines(p).length).toBe(before)
  expect(await excerpts(p)).toEqual([])
})

// Scenario: A ghost excerpt is accepted the same way as every other ghost
test('67.5 a ghost excerpt is accepted the same way as every other ghost', async () => {
  const p = projectWith(card('werk-excerpt', 'Quote the transcript'))
  recordSession(p, [line('user', 'Every quote was written from memory')])
  werkOk(p, ['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  // When the person accepts the ghost excerpt
  werkOk(p, ['accept', 'werk-excerpt:ex0', '--actor', 'you'])
  // Then the excerpt shows as a normal node and no longer as a ghost
  const ex = await excerpts(p)
  expect(ex[0]!.proposed).toBe(false)
  expect(werkOk(p, ['show', 'werk-excerpt:ex0'])).toContain('state: real')
  // And the card still shows the excerpt as supported_by evidence
  expect(werkOk(p, ['show', 'werk-excerpt'])).toMatch(/supported-by: .*#werk-excerpt:ex0/)
})
