import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { graph, logLines, ok, projectWith, realCard } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

const SESSION = 'aaaa1111-0000-4000-8000-000000000067'

const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const filler = (n: number) => JSON.stringify({ type: 'summary', summary: `line ${n}` })

/** Records a session transcript where Claude Code keeps it, under the HOME of the project. */
function record(lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${SESSION}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

const excerpts = () => graph(p).nodes.filter((n) => n.kind === 'excerpt')

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = projectWith(...realCard('werk-excerpt', 'Excerpts'))
  const message = 'Every quote in the imported map was written from memory'
  record([filler(0), assistant('What went wrong with the import?'), user(message), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = excerpts()
  expect(ex).toHaveLength(1)
  const id = ex[0]!.id
  const show = ok(p, ['show', id])
  expect(show).toContain('state: ghost')
  const start = message.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(show).toContain(`session ${SESSION}`)
  expect(show).toContain('message 2')
  expect(show).toContain('said by user')
  expect(show).toContain(`characters ${start}-${end}`)
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  p = projectWith(...realCard('werk-excerpt', 'Excerpts'))
  const quoted = 'the fold reads the log from the top'
  const file = record([
    user('How does the map read the log?'),
    assistant(`Each change is a new line, and ${quoted}, every time.`),
  ])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const id = excerpts()[0]!.id
  const show = ok(p, ['show', id])
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)
  expect(m).not.toBeNull()
  const [, session, index, start, end, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(index)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(start), Number(end))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', () => {
  p = projectWith(...realCard('werk-excerpt', 'Excerpts'))
  record([user('Promise me one thing.'), assistant('Yes: the tool never guesses.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p)).toHaveLength(before)
  expect(excerpts()).toHaveLength(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', () => {
  p = projectWith(...realCard('werk-excerpt', 'Excerpts'))
  const lines = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? user(`question ${i}`) : assistant(`answer ${i}`)))
  lines[3] = assistant('The reader fails instead of guessing, by design.')
  lines[7] = assistant('Again: it fails instead of guessing.')
  record(lines)
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(r.stderr).toContain('3, 7')
  expect(logLines(p)).toHaveLength(before)
  expect(excerpts()).toHaveLength(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  p = projectWith(...realCard('werk-excerpt', 'Excerpts'))
  record([user('Keep the map in an append-only log.')])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', 'append-only log'])
  const id = excerpts()[0]!.id
  ok(p, ['accept', id, '--actor', 'you'])
  const show = ok(p, ['show', id])
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})
