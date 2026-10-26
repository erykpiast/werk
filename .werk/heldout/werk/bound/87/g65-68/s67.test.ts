import { test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { project, user, assistant, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())
const SESSION = 'aaaa1111-2222-3333-4444-555566667777'
const excerpts = () => p.graph().nodes.filter((n) => n.kind === 'excerpt')

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = project()
  p.card('werk-excerpt')
  const said = 'Every quote in the imported map was written from memory'
  p.writeSession(SESSION, [{ type: 'summary' }, assistant('Hello there.'), user(said), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = excerpts()
  expect(ex.length).toBe(1)
  expect(ex[0]!.proposed).toBe(true)
  const show = p.ok(['show', ex[0]!.id])
  expect(show).toContain('state: ghost')
  const start = said.indexOf('written from memory')
  expect(show).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(p.ok(['show', 'werk-excerpt'])).toContain(`supported-by: #${ex[0]!.id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  p = project()
  p.card('werk-excerpt')
  const quoted = 'the tool never guesses'
  p.writeSession(SESSION, [user('Tell me the rule.'), assistant(`The rule: ${quoted}, it fails.`)])
  p.ok(['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const id = excerpts()[0]!.id
  const show = p.ok(['show', id])
  const m = show.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, idx, a, b, speaker] = m!
  const file = join(dirname(p.dir), '.claude', 'projects', '-tmp-proj', `${session}.jsonl`)
  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(idx)]!)
  const text = typeof line.message.content === 'string' ? line.message.content : line.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  expect(text.slice(Number(a), Number(b))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', () => {
  p = project()
  p.card('werk-excerpt')
  p.writeSession(SESSION, [user('Say the rule.'), assistant('Yes: the tool never guesses.')])
  const before = p.logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no exact match')
  expect(p.logLines().length).toBe(before)
  expect(excerpts().length).toBe(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', () => {
  p = project()
  p.card('werk-excerpt')
  const t = 'fails instead of guessing'
  p.writeSession(SESSION, [user('a'), assistant('b'), user('c'), assistant(`It ${t}.`), user('d'), assistant('e'), user('f'), user(`So it ${t}?`)])
  const before = p.logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', t])
  expect(r.code).not.toBe(0)
  const err = r.stdout + r.stderr
  expect(err).toMatch(/\b3\b/); expect(err).toMatch(/\b7\b/)
  expect(p.logLines().length).toBe(before)
  expect(excerpts().length).toBe(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  p = project()
  p.card('werk-excerpt')
  p.writeSession(SESSION, [user('the tool never guesses')])
  p.ok(['quote', 'werk-excerpt', SESSION, '--text', 'never guesses'])
  const id = excerpts()[0]!.id
  p.ok(['accept', id, '--actor', 'you'])
  expect(p.ok(['show', id])).toContain('state: real')
  expect(excerpts()[0]!.proposed).toBe(false)
  expect(p.ok(['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})
