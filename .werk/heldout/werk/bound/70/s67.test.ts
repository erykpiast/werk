import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, graphOf, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const SESSION = '0d6a1f2e-7b3c-4c1d-9e8f-aa00bb11cc22'

/** Records a session transcript where Claude Code keeps it: ~/.claude/projects/<dir>/<session>.jsonl. */
function recordSession(messages: { role: 'user' | 'assistant'; text: string }[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-tmp-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  const lines = messages.map((m) =>
    JSON.stringify({
      type: m.role,
      sessionId: SESSION,
      message: { role: m.role, content: m.role === 'user' ? m.text : [{ type: 'text', text: m.text }] },
    }),
  )
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const withCard = () => p.writeLog([proposed('werk-excerpt', { title: 'Quote the transcript' }), accepted('werk-excerpt')])

test('67.1 a quote found once becomes a ghost excerpt on the citing card', async () => {
  p = project()
  withCard()
  const said = 'Every quote in the imported map was written from memory'
  recordSession([
    { role: 'user', text: 'Hello there' },
    { role: 'assistant', text: 'Hi, what do you need?' },
    { role: 'user', text: said },
  ])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const graph = await graphOf(p)
  const excerpt = graph.nodes.find((n) => n.kind === 'excerpt')
  expect(excerpt?.proposed).toBe(true)
  const show = p.werk(['show', excerpt.id]).stdout
  const start = said.indexOf('written from memory')
  expect(show).toContain('ghost')
  expect(show).toContain(`session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(p.werk(['show', 'werk-excerpt']).stdout).toContain(`supported-by: #${excerpt.id}`)
})

test('67.2 the excerpt lets the person find the quote again', () => {
  p = project()
  withCard()
  const path = recordSession([
    { role: 'user', text: 'How does the reader work?' },
    { role: 'assistant', text: 'The reader finds the quote verbatim, and the tool never guesses at a match.' },
  ])
  const quoteText = 'the tool never guesses at a match'
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoteText]).code).toBe(0)
  const show = p.werk(['show', 'werk-excerpt:ex0']).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)
  expect(m).not.toBeNull()
  const [, session, index, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(index)]!)
  const text = (line.message.content as { type: string; text: string }[]).map((b) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quoteText)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', async () => {
  p = project()
  withCard()
  recordSession([{ role: 'assistant', text: 'Remember: the tool never guesses.' }])
  const before = p.lines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(p.lines().length).toBe(before)
  expect((await graphOf(p)).nodes.filter((n) => n.kind === 'excerpt')).toEqual([])
})

test('67.4 a quote in two messages fails and names both', async () => {
  p = project()
  withCard()
  const msgs = Array.from({ length: 9 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    text: i === 3 || i === 7 ? `Message ${i}: the tool fails instead of guessing.` : `Message ${i} says something else.`,
  }))
  recordSession(msgs)
  const before = p.lines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(r.stderr).toContain('message')
  expect(p.lines().length).toBe(before)
  expect((await graphOf(p)).nodes.filter((n) => n.kind === 'excerpt')).toEqual([])
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = project()
  withCard()
  recordSession([{ role: 'user', text: 'Keep every quote exact.' }])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'every quote exact']).code).toBe(0)
  expect(p.werk(['accept', 'werk-excerpt:ex0', '--actor', 'you']).code).toBe(0)
  const show = p.werk(['show', 'werk-excerpt:ex0']).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(p.werk(['show', 'werk-excerpt']).stdout).toContain('supported-by: #werk-excerpt:ex0')
})
