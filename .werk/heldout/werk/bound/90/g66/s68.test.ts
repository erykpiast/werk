/** Held-out steps 68.1–68.5: notes on a card, and the inbox. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import { proposed } from '../../src/test/map-events.ts'
import { card, logLines, logSize, ok, projectWith } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The inbox split into groups: each group starts at a line that begins with "#". */
const groups = (inbox: string) => {
  const out = new Map<string, string>()
  let current = ''
  for (const line of inbox.split('\n')) {
    const head = line.match(/^#(\S+)/)
    if (head) current = head[1]!
    if (current) out.set(current, (out.get(current) ?? '') + line + '\n')
  }
  return out
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = projectWith(card('werk-chat', 'The composer sends a live agent turn', 'decided'))
  const before = logLines(p)

  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)

  const after = logLines(p)
  expect(after).toHaveLength(before.length + 1)
  const event = JSON.parse(after.at(-1)!)
  expect(event.type).toMatch(/note/)
  expect(event.payload.id).toBe('werk-chat')
  expect(ok(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = projectWith(card('werk-chat', 'Chat', 'open'))
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])

  const group = groups(ok(p, ['inbox'])).get('werk-chat')
  expect(group).toBeDefined()
  const at = ['first', 'second', 'third'].map((t) => group!.indexOf(`: ${t}`))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual(at.toSorted((a, b) => a - b))
})

test('68.3 the inbox groups notes by card', () => {
  p = projectWith([...card('werk-chat', 'Chat', 'open'), ...card('visual', 'Visual', 'open')])
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])

  const g = groups(ok(p, ['inbox']))
  const chat = g.get('werk-chat')!
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  const visual = g.get('visual')!
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = projectWith([...card('visual', 'Visual', 'open'), proposed('werk-pane', { title: 'The pane' })])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])

  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)

  const group = groups(ok(p, ['inbox'])).get('werk-pane')
  expect(group).toBeDefined()
  expect(group).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = projectWith(card('werk-chat', 'Chat', 'open'))
  const size = logSize(p)

  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])

  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toContain('no-such-card')
  expect(out).toMatch(/unknown|no node|no card|not found/i)
  expect(logSize(p)).toBe(size)
  expect(ok(p, ['inbox'])).not.toContain('lost note')
})
