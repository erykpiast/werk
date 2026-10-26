import { afterEach, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { ok, project, type P } from '../lib.ts'
import { accepted, killed, noBasis, proposed } from '../../src/test/map-events.ts'

let p: P
afterEach(() => p?.cleanup())

/** The inbox as groups: the head line "#id  title", then the note lines under it. */
function inbox(): Map<string, string[]> {
  const out = ok(p.w('inbox')).stdout.split('\n')
  const groups = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of out) {
    const head = /^#(\S+)\s/.exec(line)
    if (head) groups.set(head[1]!, (current = []))
    else if (line.trim() !== '' && current) current.push(line)
  }
  return groups
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = project()
  p.seed(
    proposed('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided', who: 'me' }),
    noBasis('werk-chat', 'a root'),
    killed('werk-chat'),
    accepted('werk-chat'),
  )
  const before = p.events().length
  const r = p.w('say', 'werk-chat', '--text', 'The reply streams over SSE')
  expect(r.code).toBe(0)
  const added = p.events().slice(before)
  expect(added.length).toBe(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(ok(p.w('show', 'werk-chat')).stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = project()
  p.seed(proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'))
  for (const t of ['first', 'second', 'third']) ok(p.w('say', 'werk-chat', '--text', t))
  const group = inbox().get('werk-chat')
  expect(group).toBeDefined()
  const at = (t: string) => group!.findIndex((l) => l.endsWith(`: ${t}`))
  expect([at('first'), at('second'), at('third')].every((i) => i >= 0)).toBe(true)
  expect(at('first') < at('second') && at('second') < at('third')).toBe(true)
})

test('68.3 the inbox groups notes by card', () => {
  p = project()
  p.seed(proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'), proposed('visual', { title: 'Visual' }), accepted('visual'))
  ok(p.w('say', 'werk-chat', '--text', 'chat one'))
  ok(p.w('say', 'visual', '--text', 'visual one'))
  ok(p.w('say', 'werk-chat', '--text', 'chat two'))
  const groups = inbox()
  const chat = groups.get('werk-chat')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat one')).toBeLessThan(chat.indexOf('chat two'))
  const visual = groups.get('visual')!.join('\n')
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = project()
  p.seed(proposed('visual', { title: 'Visual' }), accepted('visual'), proposed('werk-pane', { title: 'The pane' }))
  ok(p.w('link', 'visual', 'werk-pane', '--type', 'depends_on'))
  expect(p.state().nodes.get('werk-pane')).toMatchObject({ proposed: true })
  expect(p.state().nodes.get('werk-pane')?.body).toBeUndefined()
  expect(p.w('say', 'werk-pane', '--text', 'Describe the pane here').code).toBe(0)
  expect(inbox().get('werk-pane')?.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = project()
  p.seed(proposed('werk-chat', { title: 'Chat' }), accepted('werk-chat'))
  const size = statSync(p.logPath).size
  const r = p.w('say', 'no-such-card', '--text', 'lost note')
  expect(r.code).not.toBe(0)
  const err = r.stderr + r.stdout
  expect(err).toContain('no-such-card')
  expect(err).toMatch(/no node|unknown|not found|no card/i)
  expect(statSync(p.logPath).size).toBe(size)
  expect(ok(p.w('inbox')).stdout).not.toContain('lost note')
})
