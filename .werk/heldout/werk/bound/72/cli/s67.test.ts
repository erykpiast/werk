import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const SESSION = 'aaaa1111-0000-4000-8000-000000000067'
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

function withTranscript(lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}
const excerpts = () => p.graph().nodes.filter((n) => n.kind === 'excerpt')

test('67.1', () => {
  p = project()
  p.realCard('werk-excerpt', 'Excerpts')
  const msg = 'Every quote in the imported map was written from memory'
  withTranscript([JSON.stringify({ type: 'summary', summary: 's' }), assistant('Hello there.'), user(msg), assistant('I see.')])
  const knownIndex = 2
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = excerpts()
  expect(ex).toHaveLength(1)
  expect(ex[0]!.proposed).toBe(true)
  const start = msg.indexOf('written from memory')
  const s = p.show(ex[0]!.id)
  expect(s).toContain(`session ${SESSION}`)
  expect(s).toContain(`message ${knownIndex}`)
  expect(s).toContain(`characters ${start}-${start + 'written from memory'.length}`)
  expect(s).toContain('said by user')
  expect(p.show('werk-excerpt')).toContain(`supported-by: #${ex[0]!.id}`)
})

test('67.2', () => {
  p = project()
  p.realCard('werk-excerpt', 'Excerpts')
  const quoteText = 'the fold reads the log from the top'
  const path = withTranscript([user('How does it work?'), assistant(`Each change is a new line, and ${quoteText}.`), user('Thanks.')])
  p.ok(['quote', 'werk-excerpt', SESSION, '--text', quoteText])
  const id = excerpts()[0]!.id
  const s = p.show(id)
  const m = s.match(/session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, msgIndex, a, b, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(msgIndex)]!)
  const text = (line.message.content as { type: string; text: string }[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  expect(text.slice(Number(a), Number(b))).toBe(quoteText)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3', () => {
  p = project()
  p.realCard('card', 'A card')
  withTranscript([user('Promise me that the tool never guesses.'), assistant('Yes.')])
  const r = p.refuses(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.stderr).toMatch(/no exact match/)
  expect(excerpts()).toHaveLength(0)
})

test('67.4', () => {
  p = project()
  p.realCard('card', 'A card')
  const lines = [
    user('m0'), assistant('m1'), user('m2'),
    assistant('It fails instead of guessing.'),
    user('m4'), assistant('m5'), user('m6'),
    user('Good: it fails instead of guessing, always.'),
  ]
  withTranscript(lines)
  const r = p.refuses(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(excerpts()).toHaveLength(0)
})

test('67.5', () => {
  p = project()
  p.realCard('card', 'A card')
  withTranscript([user('We keep every quote verbatim.')])
  p.ok(['quote', 'card', SESSION, '--text', 'every quote verbatim'])
  const id = excerpts()[0]!.id
  p.ok(['accept', id, '--actor', 'you'])
  const s = p.show(id)
  expect(s).toContain('state: real')
  expect(s).not.toMatch(/ghost/)
  expect(p.show('card')).toContain(`supported-by: #${id}`)
})
