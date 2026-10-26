import { afterEach, expect, test } from 'bun:test'
import { inboxGroups, makeMap, type Map_ } from './helpers.ts'

let m: Map_
afterEach(() => m?.cleanup())

const appendsOne = (args: string[]) => {
  const before = m.logLines()
  const r = m.werk(args)
  expect(r.code).toBe(0)
  const after = m.logLines()
  expect(after).toHaveLength(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
const refuses = (args: string[]) => {
  const before = m.logText()
  const r = m.werk(args)
  expect(r.code).not.toBe(0)
  expect(m.logText()).toBe(before)
  return r
}
const isGhost = (out: string) => /ghost/i.test(out)

test('62.1 an agent proposes a card and a person accepts it', () => {
  m = makeMap()
  m.werk(['add', 'seed1', '--title', 'Seed one'])
  m.werk(['add', 'seed2', '--title', 'Seed two'])
  expect(m.logLines().length).toBe(2)

  const add = appendsOne(['add', 'c1', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  expect(add.stdout).toContain('proposed')

  const ghost = m.werk(['show', 'c1'])
  expect(ghost.code).toBe(0)
  for (const s of ['Use a log', 'The body text', 'The why text']) expect(ghost.stdout).toContain(s)
  expect(isGhost(ghost.stdout)).toBe(true)

  appendsOne(['accept', 'c1', '--actor', 'you'])
  const real = m.werk(['show', 'c1'])
  for (const s of ['Use a log', 'The body text', 'The why text']) expect(real.stdout).toContain(s)
  expect(real.stdout).toContain('state: real')
  expect(isGhost(real.stdout)).toBe(false)
})

test('62.2 an accept without the claim refuses and leaves the ghost waiting', () => {
  m = makeMap()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  refuses(['accept', 'c1'])
  expect(isGhost(m.werk(['show', 'c1']).stdout)).toBe(true)
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const s = m.werk(['show', 'c1']).stdout
  expect(s).toContain('state: real')
  expect(isGhost(s)).toBe(false)
})

test('62.3 the words of a ghost are frozen', () => {
  m = makeMap()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  refuses(['edit', 'c1', '--body', 'A new body'])
  refuses(['retitle', 'c1', '--title', 'Use an append-only log'])
  refuses(['add', 'c1', '--title', 'Another title'])
  const s = m.werk(['show', 'c1']).stdout
  expect(s).toContain('Use a log')
  expect(isGhost(s)).toBe(true)
})

test('62.4 a retitle on a real card shows only the new title', () => {
  m = makeMap()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const lines = m.logLines()
  appendsOne(['retitle', 'c1', '--title', 'Use an append-only log'])
  const s = m.werk(['show', 'c1']).stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const after = m.logLines()
  expect(after.slice(0, lines.length)).toEqual(lines)
  expect(lines.some((l) => l.includes('"Use a log"'))).toBe(true)
  appendsOne(['edit', 'c1', '--body', 'Nothing is deleted.'])
  const s2 = m.werk(['show', 'c1']).stdout
  expect(s2).toContain('Nothing is deleted.')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  m = makeMap()
  appendsOne(['add', 'c1', '--title', 'Use a log'])
  appendsOne(['accept', 'c1', '--actor', 'you'])
  const items: [string, string[], string[]][] = [
    ['o1', ['--kind', 'option', '--title', 'Use a database', '--why-not', 'Too heavy', '--parent', 'c1'], ['Use a database', 'Too heavy']],
    ['s1', ['--kind', 'source', '--title', 'Event sourcing paper', '--body', 'Source body'], ['Event sourcing paper', 'Source body']],
    ['e1', ['--kind', 'excerpt', '--title', 'Quote', '--body', 'Logs never lie', '--parent', 's1'], ['Quote', 'Logs never lie']],
  ]
  for (const [id, flags] of items) expect(appendsOne(['add', id, ...flags]).stdout).toContain('proposed')
  for (const [id, , fields] of items) {
    const s = m.werk(['show', id]).stdout
    for (const f of fields) expect(s).toContain(f)
    expect(isGhost(s)).toBe(true)
  }
  appendsOne(['accept', 'o1', '--actor', 'you'])
  const o = m.werk(['show', 'o1']).stdout
  expect(o).toContain('state: real')
  expect(o).toContain('Too heavy')
  expect(isGhost(m.werk(['show', 's1']).stdout)).toBe(true)
  expect(isGhost(m.werk(['show', 'e1']).stdout)).toBe(true)
})

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  m = makeMap()
  m.werk(['add', 'werk-chat', '--title', 'The composer sends a live agent turn', '--status', 'decided'])
  m.werk(['accept', 'werk-chat', '--actor', 'you'])
  const before = m.logLines()
  const r = m.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = m.logLines()
  expect(after).toHaveLength(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toContain('note')
  expect(JSON.stringify(ev.payload)).toContain('werk-chat')
  expect(m.werk(['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

test('68.2 the inbox shows a whole thread in order', () => {
  m = makeMap()
  m.werk(['add', 'werk-chat', '--title', 'Chat'])
  for (const t of ['first', 'second', 'third']) expect(m.werk(['say', 'werk-chat', '--text', t]).code).toBe(0)
  const out = m.werk(['inbox']).stdout
  const g = inboxGroups(out).get('werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const idx = ['first', 'second', 'third'].map((t) => text.indexOf(t))
  expect(idx.every((i) => i >= 0)).toBe(true)
  expect(idx).toEqual([...idx].sort((a, b) => a - b))
})

test('68.3 the inbox groups notes by card', () => {
  m = makeMap()
  m.werk(['add', 'werk-chat', '--title', 'Chat'])
  m.werk(['add', 'visual', '--title', 'Visual'])
  m.werk(['say', 'werk-chat', '--text', 'chat one'])
  m.werk(['say', 'visual', '--text', 'visual one'])
  m.werk(['say', 'werk-chat', '--text', 'chat two'])
  const groups = inboxGroups(m.werk(['inbox']).stdout)
  const chat = groups.get('werk-chat')!.join('\n')
  const vis = groups.get('visual')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one')
  expect(vis).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  m = makeMap()
  expect(m.werk(['add', 'werk-pane', '--title', 'The pane']).code).toBe(0)
  expect(m.werk(['add', 'visual', '--title', 'Visual', '--parent', 'werk-pane']).code).toBe(0)
  expect(m.werk(['show', 'visual']).stdout).toContain('werk-pane')
  expect(isGhost(m.werk(['show', 'werk-pane']).stdout)).toBe(true)
  expect(m.werk(['say', 'werk-pane', '--text', 'Describe the pane here']).code).toBe(0)
  const g = inboxGroups(m.werk(['inbox']).stdout).get('werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  m = makeMap()
  m.werk(['add', 'werk-chat', '--title', 'Chat'])
  const size = m.logText().length
  const r = m.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('no-such-card')
  expect(out).toMatch(/no node|unknown/i)
  expect(m.logText().length).toBe(size)
  expect(m.werk(['inbox']).stdout).not.toContain('lost note')
})
