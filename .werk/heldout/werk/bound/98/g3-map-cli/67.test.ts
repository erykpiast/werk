import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { card, logLines, ok, projectWith, servedGraph } from './helpers.ts'

const SESSION = '7f0e0c11-0000-4000-8000-0000000000aa'

const user = (text: string) => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({ type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const summary = () => JSON.stringify({ type: 'summary', summary: 's' })

/** Records a session transcript where Claude Code keeps it, for the project's home folder. Line i is message index i. */
function recordSession(p: Project, lines: string[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')
}

type Node = { id: string; kind: string; proposed?: boolean; excerpt?: { session: string; msgIndex: number; span: [number, number]; speaker: string } }
const excerptsOf = async (p: Project) => ((await servedGraph(p)).nodes as Node[]).filter((n) => n.kind === 'excerpt')

const USER_TEXT = 'Every quote in the imported map was written from memory'

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', async () => {
  const p = projectWith(...card('werk-excerpt', 'open'))
  recordSession(p, [summary(), assistant('Hello.'), user(USER_TEXT), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = await excerptsOf(p)
  expect(ex).toHaveLength(1)
  expect(ex[0]!.proposed).toBe(true)
  const start = USER_TEXT.indexOf('written from memory')
  expect(ex[0]!.excerpt).toEqual({ session: SESSION, msgIndex: 2, span: [start, start + 'written from memory'.length], speaker: 'user' })
  const shown = ok(p, ['show', ex[0]!.id])
  expect(shown).toContain('ghost')
  expect(shown).toContain(`session ${SESSION}, message 2, characters ${start}-${start + 19}, said by user`)
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${ex[0]!.id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', async () => {
  const p = projectWith(...card('werk-excerpt', 'open'))
  const lines = [summary(), user('What does the tool do?'), assistant('It fails instead of guessing, and the tool never guesses a quote.')]
  recordSession(p, lines)
  const quote = 'the tool never guesses a quote'
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quote]).code).toBe(0)
  const [ex] = await excerptsOf(p)
  const shown = ok(p, ['show', ex!.id])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SESSION)
  const line = JSON.parse(lines[Number(m[2])]!)
  const text = (line.message.content as { text: string }[]).map((b) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe(quote)
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', async () => {
  const p = projectWith(...card('werk-excerpt', 'open'))
  recordSession(p, [summary(), user('Remember: the tool never guesses.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(logLines(p)).toHaveLength(before)
  expect(await excerptsOf(p)).toHaveLength(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', async () => {
  const p = projectWith(...card('werk-excerpt', 'open'))
  const lines = [
    summary(), user('one'), assistant('two'), assistant('The reader fails instead of guessing.'),
    user('four'), assistant('five'), user('six'), user('So it fails instead of guessing, again.'),
  ]
  recordSession(p, lines)
  const before = logLines(p)
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const msg = r.stderr + r.stdout
  expect(msg).toMatch(/\b3\b/)
  expect(msg).toMatch(/\b7\b/)
  expect(logLines(p)).toEqual(before)
  expect(await excerptsOf(p)).toHaveLength(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', async () => {
  const p = projectWith(...card('werk-excerpt', 'open'))
  recordSession(p, [summary(), user(USER_TEXT)])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory']).code).toBe(0)
  const [ex] = await excerptsOf(p)
  ok(p, ['accept', ex!.id, '--actor', 'you'])
  const after = (await excerptsOf(p))[0]!
  expect(after.proposed ?? false).toBe(false)
  expect(ok(p, ['show', ex!.id])).toContain('state: real')
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${ex!.id}`)
})
