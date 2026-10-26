import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  assistantMsg,
  logLines,
  makeProject,
  ok,
  realCard,
  show,
  summary,
  userMsg,
  writeSession,
  type Project,
} from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts are quoted')
  const message = 'Every quote in the imported map was written from memory'
  writeSession(p, SESSION, [summary(), assistantMsg('Hello there'), userMsg(message), assistantMsg('Noted.')])
  const msgIndex = 2

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const id = r.stdout.match(/proposed excerpt (\S+)/)?.[1]
  expect(id).toBeDefined()

  const ex = show(p, id!)
  expect(ex.code).toBe(0)
  expect(ex.stdout).toMatch(/ghost/)
  const start = message.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(ex.stdout).toContain(SESSION)
  expect(ex.stdout).toContain(`message ${msgIndex}`)
  expect(ex.stdout).toContain(`${start}-${end}`)
  expect(ex.stdout).toContain('user')

  const card = show(p, 'werk-excerpt').stdout
  expect(card).toContain(`supported-by: #${id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts are quoted')
  const quoted = 'the pointer names a message and a span'
  const file = writeSession(p, SESSION, [
    summary(),
    userMsg('How do I find a quote again?'),
    assistantMsg(`An excerpt is precise: ${quoted}, so you can go back.`),
  ])
  const q = p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted])
  expect(q.code).toBe(0)
  const id = q.stdout.match(/proposed excerpt (\S+)/)?.[1]
  expect(id).toBeDefined()

  const out = show(p, id!).stdout
  const m = out.match(/session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, idx, a, b, speaker] = m!
  expect(session).toBe(SESSION)

  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(idx)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')
  expect(text.slice(Number(a), Number(b))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  writeSession(p, SESSION, [userMsg('Remember: the tool never guesses.'), assistantMsg('Yes.')])
  const before = logLines(p)

  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/no exact match/)
  expect(logLines(p).length).toBe(before.length)
  expect(show(p, 'card').stdout).not.toContain('supported-by')
  expect(show(p, 'card:ex0').code).not.toBe(0)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  const lines = [
    summary(),
    userMsg('zero'),
    assistantMsg('one'),
    userMsg('The tool fails instead of guessing here.'),
    assistantMsg('four'),
    userMsg('five'),
    assistantMsg('six'),
    assistantMsg('Again it fails instead of guessing.'),
  ]
  writeSession(p, SESSION, lines)
  const before = logLines(p)

  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const err = r.stderr + r.stdout
  expect(err).toMatch(/\b3\b/)
  expect(err).toMatch(/\b7\b/)
  expect(logLines(p)).toEqual(before)
  expect(show(p, 'card').stdout).not.toContain('supported-by')
  expect(show(p, 'card:ex0').code).not.toBe(0)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  writeSession(p, SESSION, [userMsg('Accept me like any ghost.')])
  const q = ok(p.werk(['quote', 'card', SESSION, '--text', 'like any ghost']), 'quote')
  const id = q.stdout.match(/proposed excerpt (\S+)/)![1]!
  expect(show(p, id).stdout).toMatch(/ghost/)

  ok(p.werk(['accept', id, '--actor', 'you']), 'accept')
  const ex = show(p, id).stdout
  expect(ex).toContain('state: real')
  expect(ex).not.toContain('state: ghost')
  expect(show(p, 'card').stdout).toContain(`supported-by: #${id}`)
})
