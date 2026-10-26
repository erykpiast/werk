import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok, project, type P } from '../lib.ts'

let p: P
afterEach(() => p?.cleanup())

const SESSION = '11111111-2222-4333-8444-555555555555'

type Msg = { role: 'user' | 'assistant'; text: string } | { summary: string }
const line = (m: Msg) =>
  'summary' in m
    ? JSON.stringify({ type: 'summary', summary: m.summary })
    : JSON.stringify(
        m.role === 'user'
          ? { type: 'user', sessionId: SESSION, message: { role: 'user', content: m.text } }
          : { type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text: m.text }] } },
      )

/** Writes a recorded session where Claude Code keeps it, under the project HOME. */
function session(messages: Msg[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, messages.map(line).join('\n') + '\n')
  return path
}

const real = (id: string) => {
  ok(p.w('add', id, '--title', `Card ${id}`))
  ok(p.w('accept', id, '--actor', 'you'))
}
const excerpts = () => [...p.state().nodes.values()].filter((n) => n.kind === 'excerpt')

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = project()
  real('werk-excerpt')
  const said = 'Every quote in the imported map was written from memory'
  session([{ summary: 's' }, { role: 'assistant', text: 'Hello.' }, { role: 'user', text: said }])
  const r = p.w('quote', 'werk-excerpt', SESSION, '--text', 'written from memory')
  expect(r.code).toBe(0)
  const [ex] = excerpts()
  expect(ex).toBeDefined()
  expect(ex!.proposed).toBe(true)
  const show = ok(p.w('show', ex!.id)).stdout
  expect(show).toContain('ghost')
  const start = said.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(show).toContain(SESSION)
  expect(show).toContain(`message 2, characters ${start}-${end}, said by user`)
  expect(ok(p.w('show', 'werk-excerpt')).stdout).toContain(`supported-by: #${ex!.id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = project()
  real('werk-excerpt')
  const path = session([
    { role: 'user', text: 'How does it fail?' },
    { role: 'assistant', text: 'When a quote is not exact, the tool never guesses where it was.' },
  ])
  ok(p.w('quote', 'werk-excerpt', SESSION, '--text', 'the tool never guesses'))
  const [ex] = excerpts()
  const show = ok(p.w('show', ex!.id)).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)!
  expect(m).not.toBeNull()
  const [, sess, idx, a, b, speaker] = m
  expect(sess).toBe(SESSION)
  const raw = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(idx)]!)
  const content = raw.message.content
  const text = typeof content === 'string' ? content : content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')
  expect(text.slice(Number(a), Number(b))).toBe('the tool never guesses')
  expect(raw.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = project()
  real('card')
  session([{ role: 'assistant', text: 'We agreed that the tool never guesses.' }])
  const before = p.lines().length
  const r = p.w('quote', 'card', SESSION, '--text', 'the tool never gueses')
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(p.lines().length).toBe(before)
  expect(excerpts()).toEqual([])
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = project()
  real('card')
  const msgs: Msg[] = [
    { summary: 's' },
    { role: 'user', text: 'one' },
    { role: 'assistant', text: 'two' },
    { role: 'assistant', text: 'The check fails instead of guessing.' },
    { role: 'user', text: 'four' },
    { role: 'assistant', text: 'five' },
    { role: 'user', text: 'six' },
    { role: 'user', text: 'It fails instead of guessing, as I said.' },
  ]
  session(msgs)
  const before = p.lines().length
  const r = p.w('quote', 'card', SESSION, '--text', 'fails instead of guessing')
  expect(r.code).not.toBe(0)
  const err = r.stderr + r.stdout
  expect(err).toMatch(/\b3\b/)
  expect(err).toMatch(/\b7\b/)
  expect(p.lines().length).toBe(before)
  expect(excerpts()).toEqual([])
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = project()
  real('card')
  session([{ role: 'assistant', text: 'Keep the map in an append-only log.' }])
  ok(p.w('quote', 'card', SESSION, '--text', 'append-only log'))
  const [ex] = excerpts()
  ok(p.w('accept', ex!.id, '--actor', 'you'))
  const show = ok(p.w('show', ex!.id)).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(ok(p.w('show', 'card')).stdout).toContain(`supported-by: #${ex!.id}`)
})
