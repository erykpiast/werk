import { expect, test } from 'bun:test'
import { card, decided, logFile, logLines, projectWith, werkOk } from './h65-68-lib.ts'
import { statSync } from 'node:fs'
import type { NewEvent } from '../src/map/events.ts'

/** The inbox as groups: the card id of each head line, and the note texts under it. */
function inbox(out: string) {
  const groups: { id: string; notes: string[] }[] = []
  for (const line of out.split('\n')) {
    const head = /^#(\S+)\s/.exec(line)
    if (head) groups.push({ id: head[1]!, notes: [] })
    else {
      const note = /^\s+\[\d+\] \S+ \S+: (.*)$/.exec(line)
      if (note && groups.length) groups.at(-1)!.notes.push(note[1]!)
    }
  }
  return groups
}

// Scenario: An agent writes a note on a card and sees it on the card
test('68.1 an agent writes a note on a card and sees it on the card', () => {
  const p = projectWith(decided('werk-chat', 'The composer sends a live agent turn'))
  const before = logLines(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  // And the log holds one new note event that names "#werk-chat"
  const after = logLines(p)
  expect(after.length).toBe(before + 1)
  expect(JSON.parse(after.at(-1)!)).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat', text: 'The reply streams over SSE' } })
  // When the agent runs the show verb / Then the output shows the note
  expect(werkOk(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

// Scenario: An agent reads a whole card thread in order from the inbox
test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  const p = projectWith(card('werk-chat', 'Chat'))
  for (const t of ['first', 'second', 'third']) werkOk(p, ['say', 'werk-chat', '--text', t])
  const groups = inbox(werkOk(p, ['inbox']))
  const g = groups.find((x) => x.id === 'werk-chat')
  expect(g).toBeDefined()
  expect(g!.notes).toEqual(['first', 'second', 'third'])
})

// Scenario: The inbox groups notes by card
test('68.3 the inbox groups notes by card', () => {
  const p = projectWith([...card('werk-chat', 'Chat'), ...card('visual', 'Visual')])
  werkOk(p, ['say', 'werk-chat', '--text', 'chat one'])
  werkOk(p, ['say', 'visual', '--text', 'visual one'])
  werkOk(p, ['say', 'werk-chat', '--text', 'chat two'])
  const groups = inbox(werkOk(p, ['inbox']))
  expect(groups.find((x) => x.id === 'werk-chat')!.notes).toEqual(['chat one', 'chat two'])
  const v = groups.find((x) => x.id === 'visual')!
  expect(v.notes).toContain('visual one')
  expect(v.notes).not.toContain('chat one')
  expect(v.notes).not.toContain('chat two')
})

// Scenario: An agent writes a note on a ghost card
test('68.4 an agent writes a note on a ghost card', () => {
  // Given a map where the card "#visual" links to "#werk-pane" / And "#werk-pane" is a ghost with no body
  const p = projectWith([
    ...card('visual', 'Visual'),
    { type: 'node.proposed', payload: { id: 'werk-pane', kind: 'card', title: 'The pane', status: 'open' } } as NewEvent,
    { type: 'edge.linked', payload: { from: 'visual', to: 'werk-pane', type: 'depends_on' } },
  ])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = inbox(werkOk(p, ['inbox'])).find((x) => x.id === 'werk-pane')
  expect(g?.notes).toContain('Describe the pane here')
})

// Scenario: A note on an unknown card fails and changes nothing
test('68.5 a note on an unknown card fails and changes nothing', () => {
  const p = projectWith(card('werk-chat', 'Chat'))
  const size = statSync(logFile(p)).size
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  // And the output names "#no-such-card" as unknown
  expect(r.stderr + r.stdout).toMatch(/no node "no-such-card"|unknown.*no-such-card/)
  expect(statSync(logFile(p)).size).toBe(size)
  expect(werkOk(p, ['inbox'])).not.toContain('lost note')
})
