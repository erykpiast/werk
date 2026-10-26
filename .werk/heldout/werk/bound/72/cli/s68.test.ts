import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** The inbox as groups: a head line `#id  title`, then the note lines, split by blank lines. */
function inboxGroups(): Map<string, string[]> {
  const out = p.ok(['inbox']).stdout
  const groups = new Map<string, string[]>()
  for (const block of out.split('\n\n')) {
    const [head, ...rest] = block.split('\n').filter(Boolean)
    const m = head?.match(/^#(\S+)/)
    if (m) groups.set(m[1]!, rest)
  }
  return groups
}

test('68.1', () => {
  p = project()
  p.decided('werk-chat', { title: 'The composer sends a live agent turn' })
  const r = p.appendsOne(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.event.type).toBe('note.said')
  expect(r.event.payload.id).toBe('werk-chat')
  expect(p.show('werk-chat')).toContain('The reply streams over SSE')
})

test('68.2', () => {
  p = project()
  p.realCard('werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) p.ok(['say', 'werk-chat', '--text', t])
  const g = inboxGroups().get('werk-chat')
  expect(g).toBeDefined()
  const at = (t: string) => g!.findIndex((l) => l.endsWith(`: ${t}`))
  expect(at('first')).toBeGreaterThanOrEqual(0)
  expect(at('first')).toBeLessThan(at('second'))
  expect(at('second')).toBeLessThan(at('third'))
})

test('68.3', () => {
  p = project()
  p.realCard('werk-chat', 'Chat')
  p.realCard('visual', 'Visual')
  p.ok(['say', 'werk-chat', '--text', 'chat one'])
  p.ok(['say', 'visual', '--text', 'visual one'])
  p.ok(['say', 'werk-chat', '--text', 'chat two'])
  const groups = inboxGroups()
  const chat = groups.get('werk-chat')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat one')).toBeLessThan(chat.indexOf('chat two'))
  const visual = groups.get('visual')!.join('\n')
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4', () => {
  p = project()
  p.realCard('visual', 'Visual')
  p.ok(['add', 'werk-pane', '--title', 'The pane'])
  p.ok(['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  expect(p.show('werk-pane')).toMatch(/ghost/)
  expect(p.werk(['say', 'werk-pane', '--text', 'Describe the pane here']).code).toBe(0)
  const g = inboxGroups().get('werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5', () => {
  p = project()
  p.realCard('werk-chat', 'Chat')
  const r = p.refuses(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown|not found/)
  expect(p.ok(['inbox']).stdout).not.toContain('lost note')
})
