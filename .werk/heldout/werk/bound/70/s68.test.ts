import { afterEach, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { accepted, killed, linked, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const say = (id: string, text: string) => p.werk(['say', id, '--text', text])

/** The inbox, split into groups by their `#id` head line. */
function inboxGroups(): Map<string, string[]> {
  const r = p.werk(['inbox'])
  expect(r.code).toBe(0)
  const groups = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of r.stdout.split('\n')) {
    const head = /^#(\S+)/.exec(line)
    if (head) groups.set(head[1]!, (current = []))
    else if (line.trim() !== '') current?.push(line)
  }
  return groups
}
const order = (lines: string[], texts: string[]) => texts.map((t) => lines.findIndex((l) => l.endsWith(`: ${t}`)))

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = project()
  p.writeLog([
    proposed('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided', who: 'me' }),
    accepted('werk-chat'),
    killed('werk-chat'),
  ])
  const before = p.events().length
  expect(say('werk-chat', 'The reply streams over SSE').code).toBe(0)
  const added = p.events().slice(before)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(p.werk(['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = project()
  p.writeLog([proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat')])
  for (const t of ['first', 'second', 'third']) expect(say('werk-chat', t).code).toBe(0)
  const group = inboxGroups().get('werk-chat')
  expect(group).toBeDefined()
  const at = order(group!, ['first', 'second', 'third'])
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
})

test('68.3 the inbox groups notes by card', () => {
  p = project()
  p.writeLog([proposed('werk-chat', { title: 'Chat' }), proposed('visual', { title: 'Visual' }), accepted('werk-chat'), accepted('visual')])
  say('werk-chat', 'chat one')
  say('visual', 'visual one')
  say('werk-chat', 'chat two')
  const groups = inboxGroups()
  const chat = groups.get('werk-chat')!
  const visual = groups.get('visual')!
  const at = order(chat, ['chat one', 'chat two'])
  expect(at[0]).toBeGreaterThanOrEqual(0)
  expect(at[1]).toBeGreaterThan(at[0]!)
  expect(order(visual, ['visual one'])[0]).toBeGreaterThanOrEqual(0)
  expect(visual.join('\n')).not.toContain('chat one')
  expect(visual.join('\n')).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = project()
  p.writeLog([proposed('visual', { title: 'Visual' }), accepted('visual'), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on')])
  expect(say('werk-pane', 'Describe the pane here').code).toBe(0)
  const group = inboxGroups().get('werk-pane')
  expect(group).toBeDefined()
  expect(order(group!, ['Describe the pane here'])[0]).toBeGreaterThanOrEqual(0)
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = project()
  p.writeLog([proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat')])
  const size = statSync(p.logPath).size
  const r = say('no-such-card', 'lost note')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
  expect(statSync(p.logPath).size).toBe(size)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
