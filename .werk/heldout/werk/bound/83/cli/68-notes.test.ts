/** Held-out steps 68.x: notes with say, show and inbox. */
import { expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import type { Project } from '../../src/test/harness.ts'
import { decidedCard, events, logFile, ok, project, realCard, show } from './helpers.ts'

/** The inbox, as groups: the head line of each group and the note lines under it. */
function inbox(p: Project): Map<string, string[]> {
  const out = ok(p, ['inbox']).stdout
  const groups = new Map<string, string[]>()
  let current: string | undefined
  for (const line of out.split('\n')) {
    const head = /^#(\S+)\s/.exec(line)
    if (head) groups.set((current = head[1]!), [])
    else if (current && line.trim() !== '') groups.get(current)!.push(line)
  }
  return groups
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  const p = project()
  decidedCard(p, 'werk-chat', { title: 'The composer sends a live agent turn' })
  const n = events(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = events(p).slice(n)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(show(p, 'werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  const p = project()
  realCard(p, 'werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = inbox(p).get('werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const at = ['first', 'second', 'third'].map((t) => text.indexOf(`: ${t}`))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual(at.toSorted((a, b) => a - b))
})

test('68.3 the inbox groups notes by card', () => {
  const p = project()
  realCard(p, 'werk-chat', 'Chat')
  realCard(p, 'visual', 'Visual')
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const groups = inbox(p)
  const chat = groups.get('werk-chat')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  const visual = groups.get('visual')!.join('\n')
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  const p = project()
  realCard(p, 'visual', 'Visual')
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = inbox(p).get('werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  const p = project()
  realCard(p, 'werk-chat', 'Chat')
  const size = statSync(logFile(p)).size
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no-such-card')
  expect(r.stderr + r.stdout).toMatch(/no node|unknown|not found/i)
  expect(statSync(logFile(p)).size).toBe(size)
  expect(ok(p, ['inbox']).stdout).not.toContain('lost note')
})
