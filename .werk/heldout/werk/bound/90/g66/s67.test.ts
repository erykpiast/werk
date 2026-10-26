/** Held-out steps 67.1–67.5: quote a transcript into a ghost excerpt. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Project } from '../../src/test/harness.ts'
import { messagesOf } from '../../src/map/transcript.ts'
import { assistantLine, card, logLines, ok, projectWith, userLine, writeSession } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

const SESSION = '0a0b0c0d-0000-4000-8000-000000000067'
const summary = { type: 'summary', summary: 'imported map' }

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = projectWith(card('werk-excerpt', 'Quote the transcript', 'open'))
  const said = 'Every quote in the imported map was written from memory'
  writeSession(p, SESSION, [summary, assistantLine('How did you build the map?'), userLine(said), assistantLine('I see.')])
  const msgIndex = 2
  const start = said.indexOf('written from memory')
  const before = logLines(p).length

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)

  const lines = logLines(p)
  expect(lines).toHaveLength(before + 1)
  const id = JSON.parse(lines.at(-1)!).payload.id as string
  const shown = ok(p, ['show', id])
  expect(shown).toContain('state: ghost')
  expect(shown).toContain('kind: excerpt')
  expect(shown).toContain(`session ${SESSION}`)
  expect(shown).toContain(`message ${msgIndex}`)
  expect(shown).toContain(`characters ${start}-${start + 'written from memory'.length}`)
  expect(shown).toContain('said by user')
  expect(ok(p, ['show', 'werk-excerpt'])).toMatch(new RegExp(`supported-by: .*#${id}`))
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = projectWith(card('werk-excerpt', 'Quote the transcript', 'open'))
  const path = writeSession(p, SESSION, [
    summary,
    userLine('Where do quotes come from?'),
    assistantLine('Each quote is found verbatim in the session, never typed from memory.'),
  ])
  const quoted = 'found verbatim in the session'
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const id = JSON.parse(logLines(p).at(-1)!).payload.id as string

  const shown = ok(p, ['show', id])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, msg, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  // Go to the message at that index in the transcript file and cut the span.
  const raw = readFileSync(path, 'utf8')
  const line = JSON.parse(raw.split('\n')[Number(msg)]!)
  const text = messagesOf(raw).find((x) => x.index === Number(msg))!.text
  expect(text.slice(Number(from), Number(to))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = projectWith(card('store', 'Store', 'open'))
  writeSession(p, SESSION, [summary, userLine('Promise me that the tool never guesses.'), assistantLine('It does not.')])
  const before = logLines(p).length

  const r = p.werk(['quote', 'store', SESSION, '--text', 'the tool never gueses'])

  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(logLines(p)).toHaveLength(before)
  expect(ok(p, ['show', 'store'])).not.toContain('supported-by')
  expect(p.werk(['show', 'store:ex0']).code).not.toBe(0)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = projectWith(card('store', 'Store', 'open'))
  writeSession(p, SESSION, [
    summary,
    userLine('one'),
    assistantLine('two'),
    userLine('The reader fails instead of guessing, right?'),
    assistantLine('four'),
    userLine('five'),
    assistantLine('six'),
    assistantLine('Yes: it fails instead of guessing every time.'),
  ])
  const before = logLines(p).length

  const r = p.werk(['quote', 'store', SESSION, '--text', 'fails instead of guessing'])

  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(logLines(p)).toHaveLength(before)
  expect(ok(p, ['show', 'store'])).not.toContain('supported-by')
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = projectWith(card('store', 'Store', 'open'))
  writeSession(p, SESSION, [summary, userLine('Keep the map in an append-only log.')])
  ok(p, ['quote', 'store', SESSION, '--text', 'append-only log'])
  const id = JSON.parse(logLines(p).at(-1)!).payload.id as string
  expect(ok(p, ['show', id])).toContain('state: ghost')

  ok(p, ['accept', id, '--actor', 'you'])

  const shown = ok(p, ['show', id])
  expect(shown).toContain('state: real')
  expect(shown).not.toContain('ghost')
  expect(ok(p, ['show', 'store'])).toMatch(new RegExp(`supported-by: .*#${id}`))
})
