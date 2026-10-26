import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { assistantLine, logLines, makeProject, realCard, toolResultLine, userLine, writeTranscript, type Project } from './common.ts'

const SESSION = 'aaaa1111-0000-4000-8000-000000000067'
let p: Project
afterEach(() => p?.cleanup())

const quoteLine = (show: string) => {
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)
  return m && { session: m[1]!, msgIndex: Number(m[2]), start: Number(m[3]), end: Number(m[4]), speaker: m[5]! }
}

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts point into transcripts')
  const userText = 'Look at this. Every quote in the imported map was written from memory'
  writeTranscript(p, SESSION, [
    { type: 'summary', summary: 's' },
    assistantLine('Hello, what do you need?'),
    userLine(userText),
    assistantLine('I see.'),
  ])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const id = /proposed excerpt (\S+)/.exec(r.stdout)?.[1]
  expect(id).toBeDefined()
  const show = p.werk(['show', id!]).stdout
  expect(show).toContain('state: ghost')
  expect(show).toContain('kind: excerpt')
  const q = quoteLine(show)
  const start = userText.indexOf('written from memory')
  expect(q).toEqual({ session: SESSION, msgIndex: 2, start, end: start + 'written from memory'.length, speaker: 'user' })
  const card = p.werk(['show', 'werk-excerpt']).stdout
  expect(card).toContain(`supported-by: #${id}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts point into transcripts')
  const path = writeTranscript(p, SESSION, [
    userLine('Where does the map live?'),
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Keep the map in an append-only log.' }, { type: 'text', text: 'The tool never rewrites a line.' }] } },
    toolResultLine(),
  ])
  const quoted = 'never rewrites a line'
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted])
  expect(r.code).toBe(0)
  const id = /proposed excerpt (\S+)/.exec(r.stdout)![1]!
  const q = quoteLine(p.werk(['show', id]).stdout)!
  expect(q.session).toBe(SESSION)
  // Go to the message: the line of the transcript file at msgIndex, its text blocks joined by a newline.
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[q.msgIndex]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  expect(text.slice(q.start, q.end)).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(q.speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  writeTranscript(p, SESSION, [userLine('We agree that the tool never guesses.'), assistantLine('Yes.')])
  const before = logLines(p).length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(logLines(p).length).toBe(before)
  expect(p.werk(['show', 'card:ex0']).code).not.toBe(0)
  expect(p.werk(['show', 'card']).stdout).not.toContain('supported-by')
})

test('67.4 a quote in two messages fails and names both', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  writeTranscript(p, SESSION, [
    { type: 'summary', summary: 's' },
    userLine('start'),
    assistantLine('ok'),
    userLine('The tool fails instead of guessing.'),
    assistantLine('noted'),
    userLine('more'),
    assistantLine('fine'),
    assistantLine('Again: it fails instead of guessing.'),
  ])
  const before = logLines(p)
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(out).toContain('3, 7')
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['show', 'card']).stdout).not.toContain('supported-by')
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  writeTranscript(p, SESSION, [userLine('Keep one log for the map.')])
  const r = p.werk(['quote', 'card', SESSION, '--text', 'one log'])
  expect(r.code).toBe(0)
  const id = /proposed excerpt (\S+)/.exec(r.stdout)![1]!
  const a = p.werk(['accept', id, '--actor', 'you'])
  expect(a.code).toBe(0)
  const show = p.werk(['show', id]).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(p.werk(['show', 'card']).stdout).toContain(`supported-by: #${id}`)
})
