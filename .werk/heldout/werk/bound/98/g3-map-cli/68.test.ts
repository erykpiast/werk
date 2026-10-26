import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Project } from '../../src/test/harness.ts'
import { card, logFile, logLines, ok, projectWith } from './helpers.ts'

/** The inbox group of one card: its head line and the note lines under it, up to the next blank line. */
function group(out: string, id: string): string | undefined {
  const groups = out.split('\n\n')
  return groups.find((g) => g.split('\n')[0]!.startsWith(`#${id} `) || g.split('\n')[0] === `#${id}`)
}

const say = (p: Project, id: string, text: string) => ok(p, ['say', id, '--text', text])

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  const p = projectWith(...card('werk-chat', 'decided', undefined, 'The composer sends a live agent turn'))
  const before = logLines(p)
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  const p = projectWith(...card('werk-chat', 'open'))
  for (const t of ['first', 'second', 'third']) say(p, 'werk-chat', t)
  const g = group(ok(p, ['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const a = g!.indexOf(': first'), b = g!.indexOf(': second'), c = g!.indexOf(': third')
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(c).toBeGreaterThan(b)
})

test('68.3 The inbox groups notes by card', () => {
  const p = projectWith(...card('werk-chat', 'open'), ...card('visual', 'open'))
  say(p, 'werk-chat', 'chat one')
  say(p, 'visual', 'visual one')
  say(p, 'werk-chat', 'chat two')
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
  const p = projectWith(...card('visual', 'open'))
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  expect(ok(p, ['show', 'werk-pane'])).toContain('ghost')
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']), 'werk-pane')
  expect(g).toBeDefined()
  expect(g).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  const p = projectWith(...card('werk-chat', 'open'))
  const size = readFileSync(logFile(p)).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no-such-card')
  expect(r.stderr + r.stdout).toMatch(/no node|unknown|no card/i)
  expect(readFileSync(logFile(p)).length).toBe(size)
  expect(ok(p, ['inbox'])).not.toContain('lost note')
})
