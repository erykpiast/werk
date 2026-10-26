import { afterEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(60_000)
import { statSync } from 'node:fs'
import { newCtx, type Ctx } from './cli-helpers.ts'

let c: Ctx
afterEach(() => c?.p.cleanup())

/** The inbox output split into groups, by the card id on each group head line. */
const inboxGroups = () => {
  const r = c.w('inbox')
  expect(r.code).toBe(0)
  const groups = new Map<string, string[]>()
  let current: string | undefined
  for (const line of r.stdout.split('\n')) {
    const head = /^#(\S+)/.exec(line)
    if (head) groups.set((current = head[1]!), [])
    else if (current && line.trim() !== '') groups.get(current)!.push(line)
  }
  return { out: r.stdout, groups }
}
const notesIn = (lines: string[]) => lines.map((l) => /\]\s+\S+\s+\S+:\s(.*)$/.exec(l)?.[1]).filter(Boolean)

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  c = newCtx()
  c.decided('werk-chat', 'The composer sends a live agent turn')
  const n = c.events().length
  const r = c.w('say', 'werk-chat', '--text', 'The reply streams over SSE')
  expect(r.code).toBe(0)
  const added = c.events().slice(n)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(c.show('werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  c = newCtx()
  c.real('werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) c.ok('say', 'werk-chat', '--text', t)
  const { groups } = inboxGroups()
  expect(groups.has('werk-chat')).toBe(true)
  expect(notesIn(groups.get('werk-chat')!)).toEqual(['first', 'second', 'third'])
})

test('68.3 the inbox groups notes by card', () => {
  c = newCtx()
  c.real('werk-chat', 'Chat')
  c.real('visual', 'Visual')
  c.ok('say', 'werk-chat', '--text', 'chat one')
  c.ok('say', 'visual', '--text', 'visual one')
  c.ok('say', 'werk-chat', '--text', 'chat two')
  const { groups } = inboxGroups()
  expect(notesIn(groups.get('werk-chat')!)).toEqual(['chat one', 'chat two'])
  const visual = notesIn(groups.get('visual')!)
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  c = newCtx()
  c.real('visual', 'Visual')
  c.ok('add', 'werk-pane', '--title', 'The pane')
  c.ok('link', 'visual', 'werk-pane', '--type', 'depends_on')
  expect(c.w('say', 'werk-pane', '--text', 'Describe the pane here').code).toBe(0)
  const { groups } = inboxGroups()
  expect(groups.has('werk-pane')).toBe(true)
  expect(notesIn(groups.get('werk-pane')!)).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  c = newCtx()
  c.real('werk-chat', 'Chat')
  const size = statSync(c.logFile).size
  const r = c.w('say', 'no-such-card', '--text', 'lost note')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
  expect(statSync(c.logFile).size).toBe(size)
  expect(inboxGroups().out).not.toContain('lost note')
})
