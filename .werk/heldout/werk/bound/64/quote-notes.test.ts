/** Steps 67.x (quote) and 68.x (say, inbox). */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type Proj } from './lib.ts'

let p: Proj
afterEach(() => p?.cleanup())

const SESSION = '7a1c0de0-1111-4222-8333-444455556666'
const show = (id: string) => p.werk(['show', id])

const user = (text: string) => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text } })
const assistant = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: SESSION,
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text }] },
  })

/** Writes the recorded session where Claude Code keeps it: $HOME/.claude/projects/<dir>/<session>.jsonl. */
function recordSession(lines: string[]): string {
  const dir = join(p.root, '.claude', 'projects', '-tmp-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const realCard = (id: string, title: string, extra: Record<string, unknown> = {}) => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, ...extra } },
  { type: 'node.accepted', payload: { id }, actor: 'you' },
]

const summary = JSON.stringify({ type: 'summary', summary: 'A talk about quotes' })

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Quotes come from transcripts'))
  const msg = 'Every quote in the imported map was written from memory'
  recordSession([summary, assistant('What went wrong with the import?'), user(msg), assistant('I see.')])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = p.events().at(-1).payload.id as string
  const s = show(ex).stdout
  expect(s).toContain('state: ghost')
  expect(s).toContain('kind: excerpt')
  const start = msg.indexOf('written from memory')
  expect(s).toContain(`session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(show('werk-excerpt').stdout).toContain(`supported-by: #${ex}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Quotes come from transcripts'))
  const quoted = 'the fold reads the log from the top'
  const path = recordSession([summary, user('How does the map work?'), assistant(`Each change is a new line, and ${quoted}.`)])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted]).code).toBe(0)
  const ex = p.events().at(-1).payload.id as string
  const s = show(ex).stdout
  const m = s.match(/session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, idx, a, b, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(idx)]!)
  const text = (line.message.content as { type: string; text?: string }[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  expect(text.slice(Number(a), Number(b))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Quotes come from transcripts'))
  recordSession([summary, user('Promise me: the tool never guesses.'), assistant('Agreed.')])
  const n = p.logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/no exact match/)
  expect(p.logLines()).toHaveLength(n)
  expect(p.events().some((e) => e.payload?.kind === 'excerpt')).toBe(false)
})

test('67.4 a quote that occurs in two messages fails and names both', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Quotes come from transcripts'))
  recordSession([
    summary,
    user('one'),
    assistant('two'),
    user('The reader fails instead of guessing.'),
    assistant('four'),
    user('five'),
    assistant('six'),
    assistant('It still fails instead of guessing, as said.'),
  ])
  const n = p.logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(p.logLines()).toHaveLength(n)
  expect(p.events().some((e) => e.payload?.kind === 'excerpt')).toBe(false)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = project()
  p.writeLog(realCard('werk-excerpt', 'Quotes come from transcripts'))
  recordSession([summary, user('Quotes must be exact.')])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'must be exact']).code).toBe(0)
  const ex = p.events().at(-1).payload.id as string
  expect(p.werk(['accept', ex, '--actor', 'you']).code).toBe(0)
  const s = show(ex).stdout
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
  expect(show('werk-excerpt').stdout).toContain(`supported-by: #${ex}`)
})

/** The inbox groups: each starts with a "#id  title" line. */
const groups = (out: string) => {
  const map = new Map<string, string[]>()
  let cur: string[] | undefined
  for (const line of out.split('\n')) {
    const head = line.match(/^#(\S+)\s/)
    if (head) map.set(head[1]!, (cur = []))
    else if (line.trim() !== '' && cur) cur.push(line)
  }
  return map
}
const noteTexts = (lines: string[] | undefined) => (lines ?? []).map((l) => l.replace(/^\s*\[\d+\] \S+ \S+: /, ''))

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = project()
  p.writeLog(
    realCard('werk-chat', 'The composer sends a live agent turn', { status: 'decided', who: 'me', noBasis: 'root', kills: undefined }),
  )
  const n = p.logLines().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const added = p.events().slice(n)
  expect(added).toHaveLength(1)
  expect(added[0].type).toMatch(/note/)
  expect(JSON.stringify(added[0].payload)).toContain('werk-chat')
  expect(show('werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = project()
  p.writeLog(realCard('werk-chat', 'The composer sends a live agent turn'))
  for (const t of ['first', 'second', 'third']) expect(p.werk(['say', 'werk-chat', '--text', t]).code).toBe(0)
  const r = p.werk(['inbox'])
  expect(r.code).toBe(0)
  const g = groups(r.stdout)
  expect(g.has('werk-chat')).toBe(true)
  expect(noteTexts(g.get('werk-chat'))).toEqual(['first', 'second', 'third'])
})

test('68.3 the inbox groups notes by card', () => {
  p = project()
  p.writeLog([...realCard('werk-chat', 'Chat'), ...realCard('visual', 'Visual')])
  for (const [id, t] of [['werk-chat', 'chat one'], ['visual', 'visual one'], ['werk-chat', 'chat two']] as const) {
    expect(p.werk(['say', id, '--text', t]).code).toBe(0)
  }
  const g = groups(p.werk(['inbox']).stdout)
  expect(noteTexts(g.get('werk-chat'))).toEqual(['chat one', 'chat two'])
  expect(noteTexts(g.get('visual'))).toEqual(['visual one'])
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = project()
  p.writeLog([
    ...realCard('visual', 'Visual'),
    { type: 'node.proposed', payload: { id: 'werk-pane', kind: 'card', title: 'The werk pane' } },
    { type: 'edge.linked', payload: { from: 'visual', to: 'werk-pane', type: 'depends_on' } },
  ])
  expect(p.werk(['say', 'werk-pane', '--text', 'Describe the pane here']).code).toBe(0)
  const g = groups(p.werk(['inbox']).stdout)
  expect(noteTexts(g.get('werk-pane'))).toEqual(['Describe the pane here'])
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = project()
  p.writeLog(realCard('werk-chat', 'Chat'))
  const size = readFileSync(p.logPath).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.out).toContain('no-such-card')
  expect(r.out).toMatch(/no node|unknown/)
  expect(readFileSync(p.logPath).length).toBe(size)
  expect(p.werk(['inbox']).out).not.toContain('lost note')
})
