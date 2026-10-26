import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acc, lnk, project, prop, type P } from './cli-util.ts'

let p: P
afterEach(() => p?.cleanup())

const SID = '0f6c2a4e-1111-2222-3333-444455556666'
type Msg = ['user' | 'assistant', string]
function transcript(messages: Msg[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-tmp-some-project')
  mkdirSync(dir, { recursive: true })
  const lines = messages.map(([role, text]) => JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } }))
  const path = join(dir, `${SID}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const withCard = () => {
  p = project()
  p.seed([prop('werk-excerpt', { title: 'Quotes come from transcripts' }), acc('werk-excerpt')])
}

test('67.1', () => {
  withCard()
  const msg = 'Every quote in the imported map was written from memory'
  transcript([['user', 'Hello there'], ['assistant', 'Hi, what do you need?'], ['user', msg]])
  const r = p.w('quote', 'werk-excerpt', SID, '--text', 'written from memory')
  console.log('67.1 quote:', r.code, r.all.trim())
  expect(r.code).toBe(0)
  const ex = [...p.state().nodes.values()].find((n) => n.kind === 'excerpt')!
  expect(ex).toBeDefined()
  expect(ex.proposed).toBe(true)
  const show = p.w('show', ex.id).stdout
  console.log('67.1 show excerpt:\n' + show)
  const start = msg.indexOf('written from memory')
  expect(show).toMatch(/ghost/)
  expect(show).toContain(SID)
  expect(show).toContain(`message 2`)
  expect(show).toContain('said by user')
  expect(show).toContain(`${start}-${start + 'written from memory'.length}`)
  const card = p.w('show', 'werk-excerpt').stdout
  expect(card).toContain(`supported-by: #${ex.id}`)
})

test('67.2', () => {
  withCard()
  const path = transcript([
    ['user', 'How do I quote?'],
    ['assistant', 'werk quotes the exact text, and the tool never guesses where a quote came from.'],
  ])
  p.ok('quote', 'werk-excerpt', SID, '--text', 'the tool never guesses')
  const ex = [...p.state().nodes.values()].find((n) => n.kind === 'excerpt')!
  const show = p.w('show', ex.id).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SID)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(m[2])]!)
  const text = line.message.content.map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe('the tool never guesses')
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3', () => {
  withCard()
  transcript([['user', 'Promise me that the tool never guesses.'], ['assistant', 'Yes.']])
  const before = p.lines().length
  const r = p.w('quote', 'werk-excerpt', SID, '--text', 'the tool never gueses')
  console.log('67.3:', r.code, r.all.trim())
  expect(r.code).not.toBe(0)
  expect(r.all).toMatch(/no exact match/)
  expect(p.lines().length).toBe(before)
  expect([...p.state().nodes.values()].some((n) => n.kind === 'excerpt')).toBe(false)
})

test('67.4', () => {
  withCard()
  const msgs: Msg[] = Array.from({ length: 9 }, (_, i) => [i % 2 === 0 ? 'user' : 'assistant', `message number ${i}`] as Msg)
  msgs[3] = ['assistant', 'The reader fails instead of guessing, always.']
  msgs[7] = ['assistant', 'Again: it fails instead of guessing.']
  transcript(msgs)
  const before = p.lines().length
  const r = p.w('quote', 'werk-excerpt', SID, '--text', 'fails instead of guessing')
  console.log('67.4:', r.code, r.all.trim())
  expect(r.code).not.toBe(0)
  expect(r.all).toMatch(/\b3\b/)
  expect(r.all).toMatch(/\b7\b/)
  expect(p.lines().length).toBe(before)
  expect([...p.state().nodes.values()].some((n) => n.kind === 'excerpt')).toBe(false)
})

test('67.5', () => {
  withCard()
  transcript([['user', 'Every quote in the imported map was written from memory']])
  p.ok('quote', 'werk-excerpt', SID, '--text', 'written from memory')
  const ex = [...p.state().nodes.values()].find((n) => n.kind === 'excerpt')!
  const r = p.w('accept', ex.id, '--actor', 'you')
  expect(r.code).toBe(0)
  const show = p.w('show', ex.id).stdout
  expect(show).toContain('state: real')
  expect(show).not.toMatch(/ghost/)
  expect(p.w('show', 'werk-excerpt').stdout).toContain(`supported-by: #${ex.id}`)
})

/** The inbox output as groups: head line and the note texts. */
function groups(out: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const block of out.trim().split(/\n\s*\n/)) {
    const [head, ...rest] = block.split('\n')
    const id = /^#(\S+)/.exec(head!)?.[1]
    if (id) map.set(id, rest.map((l) => l.replace(/^\s*\[\d+\]\s+\S+\s+\S+:\s/, '')))
  }
  return map
}

test('68.1', () => {
  p = project()
  p.seed([prop('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided' }), acc('werk-chat')])
  const before = p.log().length
  const r = p.w('say', 'werk-chat', '--text', 'The reply streams over SSE')
  expect(r.code).toBe(0)
  const added = p.log().slice(before)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(p.w('show', 'werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2', () => {
  p = project()
  p.seed([prop('werk-chat', { title: 'Chat' }), acc('werk-chat')])
  for (const t of ['first', 'second', 'third']) p.ok('say', 'werk-chat', '--text', t)
  const out = p.w('inbox').stdout
  console.log('68.2 inbox:\n' + out)
  expect(groups(out).get('werk-chat')).toEqual(['first', 'second', 'third'])
})

test('68.3', () => {
  p = project()
  p.seed([prop('werk-chat', { title: 'Chat' }), acc('werk-chat'), prop('visual', { title: 'Visual' }), acc('visual')])
  p.ok('say', 'werk-chat', '--text', 'chat one')
  p.ok('say', 'visual', '--text', 'visual one')
  p.ok('say', 'werk-chat', '--text', 'chat two')
  const g = groups(p.w('inbox').stdout)
  expect(g.get('werk-chat')).toEqual(['chat one', 'chat two'])
  expect(g.get('visual')).toEqual(['visual one'])
})

test('68.4', () => {
  p = project()
  p.seed([prop('visual', { title: 'Visual' }), acc('visual'), prop('werk-pane', { title: 'The pane' }), lnk('visual', 'werk-pane', 'depends_on')])
  expect(p.w('say', 'werk-pane', '--text', 'Describe the pane here').code).toBe(0)
  const out = p.w('inbox').stdout
  console.log('68.4 inbox:\n' + out)
  expect(groups(out).get('werk-pane')).toEqual(['Describe the pane here'])
})

test('68.5', () => {
  p = project()
  p.seed([prop('werk-chat', { title: 'Chat' }), acc('werk-chat')])
  const size = readFileSync(join(p.dir, '.werk', 'log.jsonl')).length
  const r = p.w('say', 'no-such-card', '--text', 'lost note')
  console.log('68.5:', r.code, r.all.trim())
  expect(r.code).not.toBe(0)
  expect(r.all).toContain('no-such-card')
  expect(r.all).toMatch(/no node|unknown/)
  expect(readFileSync(join(p.dir, '.werk', 'log.jsonl')).length).toBe(size)
  expect(p.w('inbox').stdout).not.toContain('lost note')
})
