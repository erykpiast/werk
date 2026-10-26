import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newCtx, type Ctx } from './cli-helpers.ts'

const SESSION = '0a0b0c0d-1111-4222-8333-444455556666'
let c: Ctx
afterEach(() => c?.p.cleanup())

type Msg = { role: 'user' | 'assistant'; text: string } | { summary: string }
/** Writes a recorded session under the Claude config dir of the project HOME. Returns its path. */
function recordSession(messages: Msg[]): string {
  const dir = join(c.p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const lines = messages.map((m, i) =>
    'summary' in m
      ? JSON.stringify({ type: 'summary', summary: m.summary })
      : JSON.stringify({
          type: m.role,
          uuid: `u${i}`,
          sessionId: SESSION,
          message: { role: m.role, content: m.role === 'user' ? m.text : [{ type: 'text', text: m.text }] },
        }),
  )
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  c = newCtx()
  c.real('werk-excerpt', 'Excerpts quote transcripts')
  const message = 'Every quote in the imported map was written from memory'
  recordSession([
    { summary: 's' },
    { role: 'user', text: 'Hello there.' },
    { role: 'assistant', text: 'Hi.' },
    { role: 'user', text: message },
  ])
  const index = 3
  const before = new Set(c.graph().nodes.map((n) => n.id))
  const r = c.w('quote', 'werk-excerpt', SESSION, '--text', 'written from memory')
  expect(r.code).toBe(0)

  const added = c.graph().nodes.filter((n) => !before.has(n.id))
  expect(added).toHaveLength(1)
  const ex = added[0]!
  expect(ex.kind).toBe('excerpt')
  expect(ex.proposed).toBe(true)
  const start = message.indexOf('written from memory')
  const s = c.show(ex.id).stdout
  expect(s).toContain('ghost')
  expect(s).toContain(`session ${SESSION}`)
  expect(s).toContain(`message ${index}`)
  expect(s).toContain(`characters ${start}-${start + 'written from memory'.length}`)
  expect(s).toContain('said by user')
  expect(c.show('werk-excerpt').stdout).toContain(`supported-by: #${ex.id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  c = newCtx()
  c.real('werk-excerpt', 'Excerpts quote transcripts')
  const quoteText = 'the fold reads the log from the top'
  const path = recordSession([
    { role: 'user', text: 'How does the map read?' },
    { role: 'assistant', text: `Each change is a new line, and ${quoteText}, every time.` },
  ])
  c.ok('quote', 'werk-excerpt', SESSION, '--text', quoteText)
  const ex = c.graph().nodes.find((n) => n.kind === 'excerpt')!
  const s = c.show(ex.id).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(s)
  expect(m).not.toBeNull()
  const [, session, idx, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(idx)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quoteText)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  c = newCtx()
  c.real('card', 'A card')
  recordSession([{ role: 'assistant', text: 'Remember that the tool never guesses at all.' }])
  const n = c.lines().length
  const r = c.w('quote', 'card', SESSION, '--text', 'the tool never gueses')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no exact match')
  expect(c.lines()).toHaveLength(n)
  expect(c.graph().nodes.some((x) => x.kind === 'excerpt')).toBe(false)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  c = newCtx()
  c.real('card', 'A card')
  const msgs: Msg[] = []
  for (let i = 0; i < 9; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    msgs.push({ role, text: i === 3 || i === 7 ? `The reader fails instead of guessing, message ${i === 3 ? 'three' : 'seven'}.` : `filler line ${i}` })
  }
  recordSession(msgs)
  const n = c.lines().length
  const r = c.w('quote', 'card', SESSION, '--text', 'fails instead of guessing')
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(c.lines()).toHaveLength(n)
  expect(c.graph().nodes.some((x) => x.kind === 'excerpt')).toBe(false)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  c = newCtx()
  c.real('card', 'A card')
  recordSession([{ role: 'user', text: 'Keep every quote verbatim please.' }])
  c.ok('quote', 'card', SESSION, '--text', 'every quote verbatim')
  const ex = c.graph().nodes.find((n) => n.kind === 'excerpt')!
  expect(c.w('accept', ex.id, '--actor', 'you').code).toBe(0)
  const s = c.show(ex.id).stdout
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
  expect(c.show('card').stdout).toContain(`supported-by: #${ex.id}`)
})
