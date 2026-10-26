import { test, expect, afterEach } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** The inbox group of one card: its head line and the note lines up to the next blank line. */
function group(out: string, id: string): string | undefined {
  const blocks = out.split('\n\n')
  return blocks.find((b) => b.startsWith(`#${id} `) || b.startsWith(`#${id}\n`))
}

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  p = project()
  p.decided('werk-chat', [], { title: 'The composer sends a live agent turn' })
  const before = p.logLines().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = p.logLines()
  expect(after.length).toBe(before + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toBe('note.said'); expect(ev.payload.id).toBe('werk-chat')
  expect(p.ok(['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  p = project()
  p.card('werk-chat')
  for (const t of ['first', 'second', 'third']) p.ok(['say', 'werk-chat', '--text', t])
  const g = group(p.ok(['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const i = ['first', 'second', 'third'].map((t) => g!.indexOf(`: ${t}`))
  expect(i.every((x) => x > 0)).toBe(true)
  expect(i[0]! < i[1]! && i[1]! < i[2]!).toBe(true)
})

test('68.3 The inbox groups notes by card', () => {
  p = project()
  p.card('werk-chat'); p.card('visual')
  p.ok(['say', 'werk-chat', '--text', 'chat one'])
  p.ok(['say', 'visual', '--text', 'visual one'])
  p.ok(['say', 'werk-chat', '--text', 'chat two'])
  const out = p.ok(['inbox'])
  const chat = group(out, 'werk-chat')!, vis = group(out, 'visual')!
  expect(chat).toBeDefined(); expect(vis).toBeDefined()
  expect(chat.indexOf('chat one')).toBeGreaterThan(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one'); expect(vis).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  p = project()
  p.card('visual')
  p.ok(['add', 'werk-pane', '--title', 'The pane'])
  p.ok(['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(p.ok(['inbox']), 'werk-pane')
  expect(g).toBeDefined()
  expect(g!).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  p = project()
  p.card('werk-chat')
  const before = p.logLines().join('\n').length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const err = r.stdout + r.stderr
  expect(err).toContain('no-such-card'); expect(err).toMatch(/no node|unknown/)
  expect(p.logLines().join('\n').length).toBe(before)
  expect(p.ok(['inbox'])).not.toContain('lost note')
})
