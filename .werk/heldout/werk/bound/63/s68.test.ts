import { afterEach, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { logEvents, logFile, logLines, makeProject, ok, realCard, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The lines of the inbox group headed by `#id`, up to the blank line before the next group. */
function group(out: string, id: string): string[] | undefined {
  const lines = out.split('\n')
  const at = lines.findIndex((l) => l.startsWith(`#${id} `) || l === `#${id}`)
  if (at === -1) return undefined
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((l) => l.trim() === '' || l.startsWith('#'))
  return end === -1 ? rest : rest.slice(0, end)
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'The composer sends a live agent turn')
  ok(p.werk(['status', 'werk-chat', 'decided']), 'decide')
  const before = logLines(p).length

  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const events = logEvents(p)
  expect(events.length).toBe(before + 1)
  const last = events.at(-1)
  expect(last.type).toMatch(/note/)
  expect(last.payload.id).toBe('werk-chat')

  const s = show(p, 'werk-chat')
  expect(s.code).toBe(0)
  expect(s.stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) ok(p.werk(['say', 'werk-chat', '--text', t]), `say ${t}`)
  const r = p.werk(['inbox'])
  expect(r.code).toBe(0)
  const g = group(r.stdout, 'werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const i1 = text.indexOf('first')
  const i2 = text.indexOf('second')
  const i3 = text.indexOf('third')
  expect(i1).toBeGreaterThan(-1)
  expect(i2).toBeGreaterThan(i1)
  expect(i3).toBeGreaterThan(i2)
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  realCard(p, 'visual', 'Visual')
  ok(p.werk(['say', 'werk-chat', '--text', 'chat one']), 'say 1')
  ok(p.werk(['say', 'visual', '--text', 'visual one']), 'say 2')
  ok(p.werk(['say', 'werk-chat', '--text', 'chat two']), 'say 3')
  const out = ok(p.werk(['inbox']), 'inbox').stdout
  const chat = group(out, 'werk-chat')!.join('\n')
  const vis = group(out, 'visual')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one')
  expect(vis).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  realCard(p, 'visual', 'Visual')
  ok(p.werk(['add', 'werk-pane', '--title', 'The pane']), 'ghost')
  ok(p.werk(['link', 'visual', 'werk-pane', '--type', 'depends_on']), 'link')
  expect(show(p, 'werk-pane').stdout).toMatch(/ghost/)

  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const out = ok(p.werk(['inbox']), 'inbox').stdout
  const g = group(out, 'werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  const size = statSync(logFile(p)).size

  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const err = r.stdout + r.stderr
  expect(err).toContain('no-such-card')
  expect(err).toMatch(/no node|unknown|not found/i)
  expect(statSync(logFile(p)).size).toBe(size)
  const inbox = p.werk(['inbox'])
  expect(inbox.stdout + inbox.stderr).not.toContain('lost note')
})
