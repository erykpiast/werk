/** Feature 67: quotes from a session transcript become ghost excerpts. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, events, graph, makeProject, ok, proposed, seed, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())
const SESSION = '7f1e2d3c-0000-4000-8000-00000000abcd'
const show = (id: string) => p.werk(['show', id]).stdout

const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const filler = (n: number) => JSON.stringify({ type: 'summary', summary: `line ${n}` })

/** Writes the transcript where werk looks for it: the Claude config dir under HOME. */
function transcript(lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}
const withCard = () => seed(p, proposed('werk-excerpt', { title: 'Quotes come from transcripts' }), accepted('werk-excerpt'))

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  withCard()
  const message = 'Every quote in the imported map was written from memory'
  transcript([filler(0), assistant('What went wrong with the import?'), user(message), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const node = graph(p).nodes.find((n) => n.kind === 'excerpt')!
  expect(node).toBeDefined()
  expect(node.proposed).toBe(true)
  const start = message.indexOf('written from memory')
  const shown = show(node.id)
  expect(shown).toContain('state: ghost')
  expect(shown).toContain(`session ${SESSION}`)
  expect(shown).toContain('message 2')
  expect(shown).toContain(`characters ${start}-${start + 'written from memory'.length}`)
  expect(shown).toContain('said by user')
  expect(show('werk-excerpt')).toContain(`supported-by: #${node.id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  withCard()
  const path = transcript([filler(0), user('How should quotes work?'), assistant('A quote is found verbatim, and the tool never guesses at all.')])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', 'the tool never guesses'])
  const id = graph(p).nodes.find((n) => n.kind === 'excerpt')!.id
  const shown = show(id)
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(shown)!
  expect(m).not.toBeNull()
  const [, session, index, start, end, speaker] = m
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(index)]!)
  const text = (line.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(start), Number(end))).toBe('the tool never guesses')
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  withCard()
  transcript([user('Rule one: the tool never guesses.')])
  const before = events(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(events(p).length).toBe(before)
  expect(graph(p).nodes.some((n) => n.kind === 'excerpt')).toBe(false)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = makeProject()
  withCard()
  transcript([
    filler(0),
    user('one'),
    assistant('two'),
    user('The tool fails instead of guessing.'),
    assistant('four'),
    user('five'),
    assistant('six'),
    assistant('Yes, it fails instead of guessing every time.'),
  ])
  const before = events(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(out).toContain('3, 7')
  expect(events(p).length).toBe(before)
  expect(graph(p).nodes.some((n) => n.kind === 'excerpt')).toBe(false)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  withCard()
  transcript([user('Keep the map in an append-only log.')])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', 'append-only log'])
  const id = graph(p).nodes.find((n) => n.kind === 'excerpt')!.id
  expect(show(id)).toContain('state: ghost')
  ok(p, ['accept', id, '--actor', 'you'])
  expect(show(id)).toContain('state: real')
  expect(show(id)).not.toContain('ghost')
  expect(show('werk-excerpt')).toContain(`supported-by: #${id}`)
})
