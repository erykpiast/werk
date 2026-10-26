/** Held-out steps 67.x: quote a recorded session into a ghost excerpt. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../src/test/harness.ts'
import { graph, inMap, lines, ok, project, realCard, show } from './helpers.ts'

const SESSION = 'aaaa1111-0000-4000-8000-000000000067'

type Msg = { role: 'user' | 'assistant'; text: string }

/** Writes a recorded session where Claude Code keeps it: <HOME>/.claude/projects/<dir>/<id>.jsonl. Returns its path. */
function record(p: Project, msgs: Msg[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  const body = [
    JSON.stringify({ type: 'summary', summary: 'a session' }),
    ...msgs.map((m, i) =>
      JSON.stringify({
        type: m.role,
        uuid: `u${i}`,
        sessionId: SESSION,
        message: { role: m.role, content: m.role === 'user' ? m.text : [{ type: 'text', text: m.text }] },
      }),
    ),
  ]
  writeFileSync(path, body.join('\n') + '\n')
  return path
}

const excerpts = (p: Project) => graph(p).nodes.filter((n) => n.kind === 'excerpt')

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  const p = project()
  realCard(p, 'werk-excerpt', 'Excerpts')
  const user = 'Every quote in the imported map was written from memory'
  record(p, [
    { role: 'assistant', text: 'Hello.' },
    { role: 'user', text: user },
    { role: 'assistant', text: 'I see.' },
  ])
  const msgIndex = 2 // the line of the user message in the file, from zero (line 0 is the summary)
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = excerpts(p)
  expect(ex).toHaveLength(1)
  expect(ex[0]!.proposed).toBe(true)
  const s = show(p, ex[0]!.id).stdout
  expect(s).toContain('ghost')
  const start = user.indexOf('written from memory')
  expect(s).toContain(`quote: session ${SESSION}, message ${msgIndex}, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(show(p, 'werk-excerpt').stdout).toContain(`supported-by: #${ex[0]!.id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  const p = project()
  realCard(p, 'werk-excerpt', 'Excerpts')
  const quoteText = 'the tool reads the log from the top'
  const path = record(p, [
    { role: 'user', text: 'How does it read?' },
    { role: 'assistant', text: `In short, ${quoteText}, line by line.` },
  ])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoteText])
  const id = excerpts(p)[0]!.id
  const s = show(p, id).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(s)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(m[2])]!) as {
    message: { role: string; content: { type: string; text: string }[] }
  }
  const text = line.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe(quoteText)
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  const p = project()
  realCard(p, 'card', 'A card')
  record(p, [{ role: 'assistant', text: 'Remember: the tool never guesses.' }])
  const before = lines(p).length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/no exact match/)
  expect(lines(p).length).toBe(before)
  expect(excerpts(p)).toHaveLength(0)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  const p = project()
  realCard(p, 'card', 'A card')
  // Line 0 is the summary; messages 1..8 follow. Message 3 and message 7 hold the text.
  const msgs: Msg[] = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: i + 1 === 3 || i + 1 === 7 ? `It fails instead of guessing, says line ${i + 1}.` : `Other text ${i + 1}.`,
  }))
  record(p, msgs)
  const before = lines(p).length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const err = r.stderr + r.stdout
  console.log(`67.4 error: ${err.trim()}`)
  expect(err).toMatch(/\b3\b/)
  expect(err).toMatch(/\b7\b/)
  expect(lines(p).length).toBe(before)
  expect(excerpts(p)).toHaveLength(0)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  const p = project()
  realCard(p, 'card', 'A card')
  record(p, [{ role: 'user', text: 'Keep every quote exact.' }])
  ok(p, ['quote', 'card', SESSION, '--text', 'every quote exact'])
  const id = excerpts(p)[0]!.id
  ok(p, ['accept', id, '--actor', 'you'])
  const s = show(p, id).stdout
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
  expect(inMap(p, id)).toBe(true)
  expect(show(p, 'card').stdout).toContain(`supported-by: #${id}`)
})
