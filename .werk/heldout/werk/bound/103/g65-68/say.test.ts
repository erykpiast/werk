import { expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { makeProject } from '../../src/test/harness.ts'
import { card, logFile, logLines, ok, seeded, SLOW } from './util.ts'

/** The lines of the inbox group headed by `id`. */
const group = (inbox: string, id: string): string[] | undefined => {
  const blocks = inbox.split('\n\n')
  const b = blocks.find((x) => x.trimStart().startsWith(`#${id} `))
  return b?.split('\n').slice(1)
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  const p = seeded(...card('werk-chat', 'decided', undefined, 'The composer sends a live agent turn'))
  const before = logLines(p).length
  const r = p.werk(['say', '#werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(p, ['show', '#werk-chat'])).toContain('The reply streams over SSE')
}, SLOW)

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  const p = seeded(...card('werk-chat', 'open'))
  for (const t of ['first', 'second', 'third']) ok(p, ['say', '#werk-chat', '--text', t])
  const g = group(ok(p, ['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const at = ['first', 'second', 'third'].map((t) => text.indexOf(`: ${t}`))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
}, SLOW)

test('68.3 the inbox groups notes by card', () => {
  const p = seeded(...card('werk-chat', 'open'), ...card('visual', 'open'))
  ok(p, ['say', '#werk-chat', '--text', 'chat one'])
  ok(p, ['say', '#visual', '--text', 'visual one'])
  ok(p, ['say', '#werk-chat', '--text', 'chat two'])
  const inbox = ok(p, ['inbox'])
  const chat = group(inbox, 'werk-chat')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  const visual = group(inbox, 'visual')!.join('\n')
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
}, SLOW)

test('68.4 an agent writes a note on a ghost card', () => {
  const p = makeProject()
  ok(p, ['add', 'visual', '--title', 'Visual'])
  ok(p, ['accept', 'visual', '--actor', 'you'])
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  expect(ok(p, ['show', 'werk-pane'])).toContain('ghost')
  const r = p.werk(['say', '#werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']), 'werk-pane')
  expect(g?.join('\n')).toContain('Describe the pane here')
}, SLOW)

test('68.5 a note on an unknown card fails and changes nothing', () => {
  const p = seeded(...card('werk-chat', 'open'))
  const size = statSync(logFile(p)).size
  const r = p.werk(['say', '#no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no (node|card)|unknown/)
  expect(statSync(logFile(p)).size).toBe(size)
  expect(readFileSync(logFile(p), 'utf8')).not.toContain('lost note')
  expect(ok(p, ['inbox'])).not.toContain('lost note')
}, SLOW)
