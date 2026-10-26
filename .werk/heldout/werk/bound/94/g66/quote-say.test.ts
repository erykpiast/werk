import { afterEach, test } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, logLines, makeProject, ok, realCard, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const SESSION = 'aaaa1111-0000-4000-8000-000000000067'

const line = (role: 'user' | 'assistant', text: string) =>
  JSON.stringify({ type: role, sessionId: SESSION, message: { role, content: role === 'user' ? text : [{ type: 'text', text }] } })

/** Writes the transcript of the session where the project's Claude config looks, and returns its path. */
const recordSession = (lines: string[]) => {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts quote the transcript')
  const userText = 'Every quote in the imported map was written from memory'
  recordSession([JSON.stringify({ type: 'summary', summary: 's' }), line('assistant', 'Hello there.'), line('user', userText)])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const id = r.stdout.match(/proposed excerpt (\S+)/)?.[1]
  expect(id).toBeDefined()
  const show = p.werk(['show', id!]).stdout
  expect(show).toContain('state: ghost')
  const start = userText.indexOf('written from memory')
  expect(show).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(p.werk(['show', 'werk-excerpt']).stdout).toMatch(new RegExp(`supported-by: .*#${id}`))
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  realCard(p, 'werk-excerpt', 'Excerpts quote the transcript')
  const quoted = 'the fold reads the log from the top'
  const path = recordSession([line('user', 'How does the map load?'), line('assistant', `Each change is a new line, and ${quoted}.`)])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted])
  expect(r.code).toBe(0)
  const id = r.stdout.match(/proposed excerpt (\S+)/)![1]!
  const m = p.werk(['show', id]).stdout.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, msg, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const raw = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(msg)]!)
  const text = (raw.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quoted)
  expect(raw.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  recordSession([line('user', 'Make sure the tool never guesses.')])
  const before = logLines(p)
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['show', 'card:ex0']).code).not.toBe(0)
  expect(p.werk(['show', 'card']).stdout).not.toContain('supported-by')
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  const lines = Array.from({ length: 9 }, (_, i) => line(i % 2 === 0 ? 'user' : 'assistant', `message number ${i}`))
  lines[3] = line('assistant', 'The reader fails instead of guessing here.')
  lines[7] = line('assistant', 'Again it fails instead of guessing.')
  recordSession(lines)
  const before = logLines(p)
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(r.stderr).toContain('3, 7')
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['show', 'card:ex0']).code).not.toBe(0)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  realCard(p, 'card', 'A card')
  recordSession([line('user', 'Keep the map in an append-only log.')])
  const id = ok(p, ['quote', 'card', SESSION, '--text', 'append-only log']).stdout.match(/proposed excerpt (\S+)/)![1]!
  expect(p.werk(['accept', id, '--actor', 'you']).code).toBe(0)
  const show = p.werk(['show', id]).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(p.werk(['show', 'card']).stdout).toMatch(new RegExp(`supported-by: .*#${id}`))
})

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'The composer sends a live agent turn', undefined)
  ok(p, ['edit', 'werk-chat', '--no-basis', 'root'])
  ok(p, ['kill', 'werk-chat', '--form', 'manual', '--text', 'use it'])
  ok(p, ['status', 'werk-chat', 'decided'])
  const before = logLines(p)
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after.length).toBe(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(p.werk(['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

/** The lines of the inbox group headed by `#id`. */
const group = (out: string, id: string) => {
  const blocks = out.split('\n\n')
  return blocks.find((b) => b.startsWith(`#${id} `)) ?? ''
}

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = group(p.werk(['inbox']).stdout, 'werk-chat')
  expect(g).not.toBe('')
  const at = ['first', 'second', 'third'].map((t) => g.indexOf(`: ${t}`))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at[0]! < at[1]! && at[1]! < at[2]!).toBe(true)
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  realCard(p, 'visual', 'Visual')
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const out = p.werk(['inbox']).stdout
  const chat = group(out, 'werk-chat')
  const visual = group(out, 'visual')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat one')).toBeLessThan(chat.indexOf('chat two'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  realCard(p, 'visual', 'Visual')
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on', '--why', 'draws in it'])
  expect(p.werk(['say', 'werk-pane', '--text', 'Describe the pane here']).code).toBe(0)
  const g = group(p.werk(['inbox']).stdout, 'werk-pane')
  expect(g).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  const before = logLines(p).join('\n').length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(logLines(p).join('\n').length).toBe(before)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
