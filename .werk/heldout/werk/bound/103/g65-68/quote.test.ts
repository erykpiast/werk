import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { logLines, mapGraph, ok, SLOW } from './util.ts'

const SESSION = '7a7a7a7a-0000-4000-8000-000000000067'
const user = (text: string) => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text } })
const assistant = (text: string) => JSON.stringify({ type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const tool = () => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } })

function withTranscript(lines: string[]): { p: Project; path: string } {
  const p = makeProject()
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-worktree')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  ok(p, ['add', 'werk-excerpt', '--title', 'Quotes come from transcripts'])
  ok(p, ['accept', 'werk-excerpt', '--actor', 'you'])
  return { p, path }
}

const excerpts = async (p: Project) => (await mapGraph(p)).nodes.filter((n) => n.kind === 'excerpt')

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', async () => {
  const said = 'Every quote in the imported map was written from memory'
  const { p } = withTranscript([JSON.stringify({ type: 'summary', summary: 's' }), assistant('Hello there.'), user(said), assistant('I see.')])
  const r = p.werk(['quote', '#werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = await excerpts(p)
  expect(ex).toHaveLength(1)
  expect(ex[0]!.proposed).toBe(true)
  const start = said.indexOf('written from memory')
  expect(ex[0]!.excerpt).toEqual({ session: SESSION, msgIndex: 2, span: [start, start + 'written from memory'.length], speaker: 'user' })
  const shown = ok(p, ['show', ex[0]!.id])
  expect(shown).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${start + 19}, said by user`)
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${ex[0]!.id}`)
}, SLOW)

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  const quote = 'the fold reads the log from the top'
  const { p, path } = withTranscript([user('How does it read?'), tool(), assistant(`Each change is a line, and ${quote}.`)])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', quote])
  expect(r.code).toBe(0)
  const id = r.stdout.match(/proposed excerpt (\S+)/)![1]!
  const shown = ok(p, ['show', id])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)!
  expect(m).not.toBeNull()
  const line = JSON.parse(readFileSync(join(p.env.HOME!, '.claude', 'projects', '-some-worktree', `${m[1]}.jsonl`), 'utf8').split('\n')[Number(m[2])]!)
  const text = (line.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe(quote)
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
  void path
}, SLOW)

test('67.3 a quote with one changed character fails and changes nothing', async () => {
  const { p } = withTranscript([user('Remember: the tool never guesses.'), assistant('Agreed.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p).length).toBe(before)
  expect(await excerpts(p)).toHaveLength(0)
}, SLOW)

test('67.4 a quote that occurs in two messages fails and names both messages', async () => {
  const lines = [
    JSON.stringify({ type: 'summary', summary: 's' }),
    user('one'),
    assistant('two'),
    assistant('The reader fails instead of guessing here.'),
    user('four'),
    tool(),
    assistant('six'),
    user('It fails instead of guessing again.'),
  ]
  const { p } = withTranscript(lines)
  const before = logLines(p)
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(r.stderr).toContain('3, 7')
  expect(logLines(p)).toEqual(before)
  expect(await excerpts(p)).toHaveLength(0)
}, SLOW)

test('67.5 a ghost excerpt is accepted the same way as every other ghost', async () => {
  const { p } = withTranscript([user('We keep every quote verbatim.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'every quote verbatim'])
  const id = r.stdout.match(/proposed excerpt (\S+)/)![1]!
  ok(p, ['accept', id, '--actor', 'you'])
  const shown = ok(p, ['show', id])
  expect(shown).toContain('state: real')
  expect(shown).not.toContain('ghost')
  const ex = (await excerpts(p)).find((n) => n.id === id)!
  expect(ex.proposed).toBeFalsy()
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
}, SLOW)
