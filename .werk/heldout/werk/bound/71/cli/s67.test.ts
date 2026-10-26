import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isGhost, isReal, logLines, makeProject, ok, out, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const SESSION = 'aaaa1111-2222-4333-8444-555566667777'
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const summary = () => JSON.stringify({ type: 'summary', summary: 's' })

/** Records a session transcript where Claude Code keeps it, under the project's HOME. */
const record = (lines: string[]) => {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${SESSION}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}
const realCard = (id: string) => {
  ok(p, ['add', id, '--title', `Card ${id}`])
  ok(p, ['accept', id, '--actor', 'you'])
}
const excerptIds = () => logLines(p).map((l) => JSON.parse(l)).filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt').map((e) => e.payload.id as string)

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  realCard('werk-excerpt')
  const msg = 'Every quote in the imported map was written from memory'
  record([summary(), assistant('Hello'), user(msg), assistant('Noted')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const [id] = excerptIds()
  expect(id).toBeDefined()
  expect(isGhost(p, id!)).toBe(true)
  const start = msg.indexOf('written from memory')
  const s = show(p, id!)
  expect(s).toContain(`session ${SESSION}`)
  expect(s).toContain('message 2')
  expect(s).toContain('said by user')
  expect(s).toContain(`characters ${start}-${start + 'written from memory'.length}`)
  expect(show(p, 'werk-excerpt')).toMatch(new RegExp(`supported-by: .*#${id!.replace(/[:]/g, '\\:')}`))
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  realCard('werk-excerpt')
  const file = record([user('What does werk do when unsure?'), assistant('When the quote is unclear, werk fails and the tool never guesses at all.')])
  const quoted = 'the tool never guesses'
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const [id] = excerptIds()
  const s = show(p, id!)
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(s)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SESSION)
  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(m[2])]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  realCard('card')
  record([user('Rule one: the tool never guesses.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toContain('no exact match')
  expect(logLines(p).length).toBe(before)
  expect(excerptIds()).toEqual([])
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = makeProject()
  realCard('card')
  const lines = [summary(), user('a'), assistant('b'), user('It fails instead of guessing, always.'), assistant('c'), user('d'), assistant('e'), assistant('Yes: it fails instead of guessing.')]
  record(lines)
  const before = logLines(p)
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toMatch(/messages?\D*3\D+7\b/)
  expect(logLines(p)).toEqual(before)
  expect(excerptIds()).toEqual([])
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  realCard('card')
  record([user('We keep a log of every decision.')])
  ok(p, ['quote', 'card', SESSION, '--text', 'a log of every decision'])
  const [id] = excerptIds()
  ok(p, ['accept', id!, '--actor', 'you'])
  expect(isReal(p, id!)).toBe(true)
  expect(show(p, id!)).not.toContain('ghost')
  expect(show(p, 'card')).toContain(`supported-by: #${id}`)
})
