/** Held-out steps 68.1-68.5: notes on a card's thread with say, inbox and show. */
import { expect, test } from 'bun:test'
import { accepted, linked, proposed } from '../../src/test/map-events.ts'
import { logLines, seeded } from './util.ts'

const chatCard = () => [
  proposed('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided' }),
  accepted('werk-chat'),
]

/** The lines of the inbox group headed by the card, up to the next group. */
function group(inbox: string, id: string): string[] | undefined {
  const groups = inbox.split(/\n\s*\n/)
  return groups.find((g) => g.split('\n')[0]!.startsWith(`#${id} `) || g.split('\n')[0] === `#${id}`)?.split('\n')
}

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  const p = seeded(chatCard())
  const before = logLines(p)
  const r = p.werk(['say', '#werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before.length + 1)
  const event = JSON.parse(after.at(-1)!) as { type: string; payload: { id: string } }
  expect(event.type).toMatch(/note/)
  expect(event.payload.id).toBe('werk-chat')
  expect(p.werk(['show', '#werk-chat']).stdout).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  const p = seeded(chatCard())
  for (const t of ['first', 'second', 'third']) expect(p.werk(['say', '#werk-chat', '--text', t]).code).toBe(0)
  const inbox = p.werk(['inbox']).stdout
  const g = group(inbox, 'werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const at = ['first', 'second', 'third'].map((t) => text.search(new RegExp(`: ${t}$`, 'm')))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at[0]! < at[1]! && at[1]! < at[2]!).toBe(true)
})

test('68.3 The inbox groups notes by card', () => {
  const p = seeded([...chatCard(), proposed('visual', { title: 'The visual layer', status: 'open' }), accepted('visual')])
  expect(p.werk(['say', '#werk-chat', '--text', 'chat one']).code).toBe(0)
  expect(p.werk(['say', '#visual', '--text', 'visual one']).code).toBe(0)
  expect(p.werk(['say', '#werk-chat', '--text', 'chat two']).code).toBe(0)
  const inbox = p.werk(['inbox']).stdout
  const chat = group(inbox, 'werk-chat')!.join('\n')
  const visual = group(inbox, 'visual')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  const p = seeded([
    proposed('visual', { title: 'The visual layer', status: 'open' }),
    accepted('visual'),
    proposed('werk-pane', { title: 'The pane' }),
    linked('visual', 'werk-pane', 'depends_on'),
  ])
  expect(p.werk(['show', 'werk-pane']).stdout).toContain('state: ghost')
  const r = p.werk(['say', '#werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(p.werk(['inbox']).stdout, 'werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  const p = seeded(chatCard())
  const before = logLines(p)
  const r = p.werk(['say', '#no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toMatch(/no node "#?no-such-card"|unknown.*no-such-card|no-such-card.*unknown/)
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
