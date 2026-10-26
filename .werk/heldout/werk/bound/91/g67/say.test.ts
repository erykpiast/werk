import { afterEach, expect, test } from 'bun:test'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'
import { logLines, logSize, makeProject, realCard, writeLog, type Project } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The lines of the inbox group headed by #id, up to the next blank line. */
function group(inbox: string, id: string): string[] | undefined {
  const lines = inbox.split('\n')
  const at = lines.findIndex((l) => l.startsWith(`#${id} `) || l === `#${id}`)
  if (at === -1) return undefined
  const end = lines.findIndex((l, i) => i > at && l.trim() === '')
  return lines.slice(at, end === -1 ? undefined : end)
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  writeLog(p, logOf(proposed('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided' }), accepted('werk-chat')))
  const before = logLines(p)
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toBe('note.said')
  expect(ev.payload.id).toBe('werk-chat')
  expect(p.werk(['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) expect(p.werk(['say', 'werk-chat', '--text', t]).code).toBe(0)
  const r = p.werk(['inbox'])
  expect(r.code).toBe(0)
  const g = group(r.stdout, 'werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const i1 = text.indexOf(': first'), i2 = text.indexOf(': second'), i3 = text.indexOf(': third')
  expect(i1).toBeGreaterThan(-1)
  expect(i2).toBeGreaterThan(i1)
  expect(i3).toBeGreaterThan(i2)
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  realCard(p, 'visual', 'Visual')
  expect(p.werk(['say', 'werk-chat', '--text', 'chat one']).code).toBe(0)
  expect(p.werk(['say', 'visual', '--text', 'visual one']).code).toBe(0)
  expect(p.werk(['say', 'werk-chat', '--text', 'chat two']).code).toBe(0)
  const out = p.werk(['inbox']).stdout
  const chat = group(out, 'werk-chat')!.join('\n')
  const visual = group(out, 'visual')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  writeLog(p, logOf(proposed('visual', { title: 'Visual' }), accepted('visual'), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on')))
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(p.werk(['inbox']).stdout, 'werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  realCard(p, 'werk-chat', 'Chat')
  const size = logSize(p)
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toContain('no-such-card')
  expect(out).toMatch(/no node|unknown|not found/i)
  expect(logSize(p)).toBe(size)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
