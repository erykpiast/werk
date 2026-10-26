/** Held-out steps 67.1-67.5: quote a transcript into a ghost excerpt. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { logLines, mapOf, seeded } from './util.ts'

const SESSION = '7a1e0c2d-0000-4000-8000-0000000000ab'

const user = (text: string) => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({ type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const toolUse = () =>
  JSON.stringify({ type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } })

/** Records a session transcript where Claude Code keeps it, under the project's home. */
function record(p: Project, lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const withCard = () => seeded([proposed('werk-excerpt', { title: 'Excerpts point into transcripts', status: 'open' }), accepted('werk-excerpt')])

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', async () => {
  const p = withCard()
  const message = 'Every quote in the imported map was written from memory'
  record(p, [JSON.stringify({ type: 'summary', summary: 's' }), assistant('Hello, what is wrong?'), user(message), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const map = await mapOf(p)
  const excerpt = map.graph.nodes.find((n) => n.id !== 'werk-excerpt')!
  expect(excerpt).toBeDefined()
  expect(excerpt.proposed).toBe(true)
  const show = p.werk(['show', excerpt.id]).stdout
  expect(show).toContain('state: ghost')
  const start = message.indexOf('written from memory')
  expect(show).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(p.werk(['show', 'werk-excerpt']).stdout).toMatch(new RegExp(`supported-by: .*#${excerpt.id}`))
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  const p = withCard()
  const path = record(p, [user('How does the tool handle a vague quote?'), toolUse(), assistant('It fails, and the tool never guesses where a quote came from.')])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never guesses']).code).toBe(0)
  const show = p.werk(['show', 'werk-excerpt:ex0']).stdout
  const m = show.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(m[2])]!) as { message: { role: string; content: { type: string; text?: string }[] } }
  const text = line.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe('the tool never guesses')
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', async () => {
  const p = withCard()
  record(p, [user('Promise me one thing.'), assistant('Yes: the tool never guesses.')])
  const before = logLines(p)
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/no exact match/)
  expect(logLines(p)).toHaveLength(before.length)
  const map = await mapOf(p)
  expect(map.graph.nodes.filter((n) => n.id !== 'werk-excerpt')).toHaveLength(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', async () => {
  const p = withCard()
  record(p, [
    user('one'),
    assistant('two'),
    user('three'),
    assistant('The tool fails instead of guessing here.'),
    user('five'),
    assistant('six'),
    user('seven'),
    user('Again: it fails instead of guessing.'),
  ])
  const before = logLines(p)
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(logLines(p)).toEqual(before)
  const map = await mapOf(p)
  expect(map.graph.nodes.filter((n) => n.id !== 'werk-excerpt')).toHaveLength(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  const p = withCard()
  record(p, [user('Keep the map in an append-only log, please.')])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'append-only log']).code).toBe(0)
  expect(p.werk(['show', 'werk-excerpt:ex0']).stdout).toContain('state: ghost')
  expect(p.werk(['accept', 'werk-excerpt:ex0', '--actor', 'you']).code).toBe(0)
  const show = p.werk(['show', 'werk-excerpt:ex0']).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(p.werk(['show', 'werk-excerpt']).stdout).toMatch(/supported-by: .*#werk-excerpt:ex0/)
})
