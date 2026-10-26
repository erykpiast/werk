import { afterEach, expect, test } from 'bun:test'
import { decide, logEvents, logLines, makeProject, ok, out, show, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const realCard = (id: string, title = `Card ${id}`) => {
  ok(p, ['add', id, '--title', title])
  ok(p, ['accept', id, '--actor', 'you'])
}
/** The inbox group for one card: its head line and the lines up to the next blank line. */
const group = (inbox: string, id: string) => {
  const lines = inbox.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`#${id} `))
  if (i === -1) return undefined
  const rest = lines.slice(i + 1)
  const end = rest.findIndex((l) => l.trim() === '')
  return rest.slice(0, end === -1 ? undefined : end).join('\n')
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  realCard('werk-chat', 'The composer sends a live agent turn')
  decide(p, 'werk-chat')
  const n = logLines(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = logEvents(p).slice(n)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(show(p, 'werk-chat')).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  realCard('werk-chat')
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = group(ok(p, ['inbox']).stdout, 'werk-chat')!
  expect(g).toBeDefined()
  const at = (t: string) => g.search(new RegExp(`: ${t}$`, 'm'))
  expect(at('first')).toBeGreaterThan(-1)
  expect(at('first')).toBeLessThan(at('second'))
  expect(at('second')).toBeLessThan(at('third'))
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  realCard('werk-chat')
  realCard('visual')
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const inbox = ok(p, ['inbox']).stdout
  const chat = group(inbox, 'werk-chat')!
  const vis = group(inbox, 'visual')!
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat one')).toBeLessThan(chat.indexOf('chat two'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one')
  expect(vis).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  realCard('visual')
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']).stdout, 'werk-pane')
  expect(g).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  realCard('werk-chat')
  const before = logLines(p).join('\n').length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toContain('no-such-card')
  expect(out(r)).toMatch(/no node|unknown/)
  expect(logLines(p).join('\n').length).toBe(before)
  expect(ok(p, ['inbox']).stdout).not.toContain('lost note')
})
