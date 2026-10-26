import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decidedCard, findTree, inboxGroups, project, realCard, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

const SESSION = '5cc3d1c4-0000-4000-8000-0000000000aa'

type Msg = { role: 'user' | 'assistant'; text: string } | { meta: string }

/** Writes a Claude Code transcript where the HOME of the project points. Returns its path. */
function writeSession(p: P, msgs: Msg[]): string {
  const path = join(dirname(p.dir), '.claude', 'projects', '-tmp-project', `${SESSION}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  const lines = msgs.map((m, i) => {
    if ('meta' in m) return JSON.stringify({ type: 'summary', summary: m.meta })
    const content = m.role === 'user' ? m.text : [{ type: 'text', text: m.text }]
    return JSON.stringify({ type: m.role, uuid: `u${i}`, sessionId: SESSION, message: { role: m.role, content } })
  })
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const quoteLine = (out: string) =>
  /^quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)$/m.exec(out)

test('67.1 a quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Excerpts'))
  const userText = 'Honestly: Every quote in the imported map was written from memory'
  writeSession(p, [
    { meta: 'the summary' },
    { role: 'assistant', text: 'Hello.' },
    { role: 'user', text: userText },
    { role: 'assistant', text: 'Noted.' },
  ])
  const ids = () => new Set(p.events().filter((e) => e.type === 'node.proposed').map((e) => (e.payload as { id: string }).id))
  const before = ids()
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect({ ...r }).toMatchObject({ code: 0 })
  const newIds = [...ids()].filter((id) => !before.has(id))
  expect(newIds.length).toBe(1)
  const ex = newIds[0]!
  const show = p.show(ex).stdout
  expect(show).toMatch(/ghost/)
  expect(show).toContain('kind: excerpt')
  const q = quoteLine(show)
  expect(q).not.toBeNull()
  const start = userText.indexOf('written from memory')
  expect([q![1], Number(q![2]), Number(q![3]), Number(q![4]), q![5]]).toEqual([SESSION, 2, start, start + 'written from memory'.length, 'user'])
  expect(p.show('werk-excerpt').stdout).toMatch(new RegExp(`supported-by: .*#${ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  expect(findTree(p.tree(), ex)?.node.proposed).toBe(true)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Excerpts'))
  const path = writeSession(p, [
    { role: 'user', text: 'Where does the map live?' },
    { role: 'assistant', text: 'Keep the map in an append-only log, so the tool never guesses.' },
  ])
  const quoted = 'append-only log, so the tool'
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted]).code).toBe(0)
  const ex = p.events().at(-1)!.payload as { id: string }
  const q = quoteLine(p.show(ex.id).stdout)!
  expect(q).not.toBeNull()
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(q[2])]!) as {
    message: { role: string; content: { type: string; text: string }[] }
  }
  const text = line.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(q[3]), Number(q[4]))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(q[5]).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Excerpts'))
  writeSession(p, [{ role: 'assistant', text: 'In werk, the tool never guesses a quote.' }])
  const n = p.events().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/no exact match/)
  expect(p.events().length).toBe(n)
  expect(p.events().filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')).toEqual([])
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Excerpts'))
  const msgs: Msg[] = []
  for (let i = 0; i < 9; i++) {
    const text = i === 3 || i === 7 ? `Message ${i}: the reader fails instead of guessing.` : `Message ${i} says something else.`
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', text })
  }
  writeSession(p, msgs)
  const n = p.events().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(p.events().length).toBe(n)
  expect(p.events().filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')).toEqual([])
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Excerpts'))
  writeSession(p, [{ role: 'user', text: 'Every quote was written from memory.' }])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory']).code).toBe(0)
  const ex = (p.events().at(-1)!.payload as { id: string }).id
  expect(p.show(ex).stdout).toMatch(/ghost/)
  expect(p.werk(['accept', ex, '--actor', 'you']).code).toBe(0)
  const s = p.show(ex).stdout
  expect(s).toContain('state: real')
  expect(s).not.toMatch(/ghost/)
  expect(p.show('werk-excerpt').stdout).toContain(`supported-by: #${ex}`)
})

// ---- 68: notes

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = project()
  p.writeLog(decidedCard('werk-chat', { title: 'The composer sends a live agent turn' }))
  const n = p.events().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = p.events().slice(n)
  expect(added.length).toBe(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(p.show('werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = project()
  p.writeLog(realCard('werk-chat', 'Chat'))
  for (const t of ['first', 'second', 'third']) expect(p.werk(['say', 'werk-chat', '--text', t]).code).toBe(0)
  const g = inboxGroups(p.werk(['inbox']).stdout).find((x) => x.id === 'werk-chat')
  expect(g).toBeDefined()
  expect(g!.notes).toEqual(['first', 'second', 'third'])
})

test('68.3 the inbox groups notes by card', () => {
  p = project()
  p.writeLog([...realCard('werk-chat', 'Chat'), ...realCard('visual', 'Visual')])
  expect(p.werk(['say', 'werk-chat', '--text', 'chat one']).code).toBe(0)
  expect(p.werk(['say', 'visual', '--text', 'visual one']).code).toBe(0)
  expect(p.werk(['say', 'werk-chat', '--text', 'chat two']).code).toBe(0)
  const groups = inboxGroups(p.werk(['inbox']).stdout)
  expect(groups.find((x) => x.id === 'werk-chat')!.notes).toEqual(['chat one', 'chat two'])
  const visual = groups.find((x) => x.id === 'visual')!
  expect(visual.notes).toContain('visual one')
  expect(visual.notes).not.toContain('chat one')
  expect(visual.notes).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = project()
  p.writeLog([
    ...realCard('visual', 'Visual'),
    { type: 'node.proposed', payload: { id: 'werk-pane', kind: 'card', title: 'The pane' } },
    { type: 'edge.linked', payload: { from: 'visual', to: 'werk-pane', type: 'depends_on' } },
  ])
  expect(p.werk(['say', 'werk-pane', '--text', 'Describe the pane here']).code).toBe(0)
  const g = inboxGroups(p.werk(['inbox']).stdout).find((x) => x.id === 'werk-pane')
  expect(g?.notes).toEqual(['Describe the pane here'])
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = project()
  p.writeLog(realCard('werk-chat', 'Chat'))
  const size = readFileSync(p.logPath).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
  expect(readFileSync(p.logPath).length).toBe(size)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
