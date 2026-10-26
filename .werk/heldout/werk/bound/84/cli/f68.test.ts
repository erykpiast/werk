/** Feature 68: notes on cards, and the inbox. */
import { afterEach, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { accepted, events, killed, linked, logFile, makeProject, noBasis, ok, proposed, seed, statusSet, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

/** The lines of one inbox group, from its head line up to the next blank line. */
function group(out: string, id: string): string[] | undefined {
  const lines = out.split('\n')
  const at = lines.findIndex((l) => l.startsWith(`#${id} `))
  if (at === -1) return undefined
  const end = lines.findIndex((l, i) => i > at && l.trim() === '')
  return lines.slice(at, end === -1 ? undefined : end)
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  seed(
    p,
    proposed('werk-chat', { title: 'The composer sends a live agent turn', who: 'me' }),
    accepted('werk-chat'),
    noBasis('werk-chat', 'root'),
    killed('werk-chat'),
    statusSet('werk-chat', 'decided'),
  )
  const before = events(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = events(p).slice(before)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  const shown = p.werk(['show', 'werk-chat'])
  expect(shown.stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  seed(p, proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'))
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const out = p.werk(['inbox']).stdout
  const g = group(out, 'werk-chat')!
  expect(g).toBeDefined()
  const at = (t: string) => g.findIndex((l) => l.endsWith(`: ${t}`))
  expect(at('first')).toBeGreaterThan(0)
  expect(at('second')).toBeGreaterThan(at('first'))
  expect(at('third')).toBeGreaterThan(at('second'))
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  seed(p, proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'), proposed('visual', { title: 'Visual' }), accepted('visual'))
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const out = p.werk(['inbox']).stdout
  const chat = group(out, 'werk-chat')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  const visual = group(out, 'visual')!.join('\n')
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  seed(p, proposed('visual', { title: 'Visual' }), accepted('visual'), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on'))
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(p.werk(['inbox']).stdout, 'werk-pane')!
  expect(g).toBeDefined()
  expect(g.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  seed(p, proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'))
  const size = statSync(logFile(p)).size
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('no-such-card')
  expect(out).toMatch(/no node|unknown|not found/)
  expect(statSync(logFile(p)).size).toBe(size)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
