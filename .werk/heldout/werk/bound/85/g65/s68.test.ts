import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Project } from '../../src/test/harness.ts'
import { linked, proposed } from '../../src/test/map-events.ts'
import { events, logFile, logLines, ok, projectWith, realCard } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The lines of the inbox group that the card heads, up to the next blank line. */
const group = (out: string, id: string) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`#${id} `))
  if (i === -1) return undefined
  const end = lines.findIndex((l, j) => j > i && l.trim() === '')
  return lines.slice(i, end === -1 ? undefined : end).join('\n')
}

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  p = projectWith(...realCard('werk-chat', 'The composer sends a live agent turn', { status: 'decided' }))
  const before = logLines(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = events(p)
  expect(after).toHaveLength(before + 1)
  expect(after.at(-1)).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(ok(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  p = projectWith(...realCard('werk-chat', 'Chat'))
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = group(ok(p, ['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const a = g!.indexOf(': first'), b = g!.indexOf(': second'), c = g!.indexOf(': third')
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(c).toBeGreaterThan(b)
})

test('68.3 The inbox groups notes by card', () => {
  p = projectWith(...realCard('werk-chat', 'Chat'), ...realCard('visual', 'Visual'))
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const out = ok(p, ['inbox'])
  const chat = group(out, 'werk-chat')!
  const visual = group(out, 'visual')!
  expect(chat).toBeDefined()
  expect(visual).toBeDefined()
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  p = projectWith(...realCard('visual', 'Visual'), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on'))
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']), 'werk-pane')
  expect(g).toBeDefined()
  expect(g!).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  p = projectWith(...realCard('werk-chat', 'Chat'))
  const size = readFileSync(logFile(p)).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
  expect(readFileSync(logFile(p)).length).toBe(size)
  expect(ok(p, ['inbox'])).not.toContain('lost note')
})
