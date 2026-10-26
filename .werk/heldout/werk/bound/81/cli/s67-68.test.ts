import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acc, kil, lnk, out, project, prop, soft, stat, type P } from './helpers.ts'

let p: P | undefined
afterEach(() => p?.cleanup())

const SESSION = '5f0c1a2b-0000-4000-8000-00000000abcd'

type Msg = { role: 'user' | 'assistant' | 'tool'; text: string }

/** Writes a recorded session where Claude Code keeps it. Line i is message index i. */
function recordSession(p: P, messages: Msg[]): string {
  const dir = join(p.claudeDir, 'projects', '-tmp-some-project')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${SESSION}.jsonl`)
  const lines = messages.map((m, i) =>
    m.role === 'tool'
      ? JSON.stringify({ type: 'system', uuid: `u${i}`, content: m.text })
      : JSON.stringify({
          type: m.role,
          uuid: `u${i}`,
          sessionId: SESSION,
          message: m.role === 'user' ? { role: 'user', content: m.text } : { role: 'assistant', content: [{ type: 'text', text: m.text }] },
        }),
  )
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

/** The text and speaker of one transcript line, the way a person reads it. */
function messageAt(file: string, index: number): { speaker: string; text: string } {
  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[index]!)
  const c = line.message.content
  const text = typeof c === 'string' ? c : c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  return { speaker: line.message.role, text }
}

const realCard = (id: string, title = `Card ${id}`) => [prop(id, title), acc(id)]
const excerptsOf = (p: P) => p.events().filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')

const filler = (n: number): Msg[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `filler message ${i}` }) as Msg)

test('67.1', () => {
  p = project(realCard('werk-excerpt', 'Quote the transcript'))
  const s = soft()
  const quoteMsg = 'Every quote in the imported map was written from memory'
  recordSession(p, [...filler(3), { role: 'user', text: quoteMsg }, ...filler(2)])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  s.check(r.code === 0, `quote exit ${r.code}: ${out(r)}`)
  const ex = excerptsOf(p)
  s.check(ex.length === 1, `excerpt events: ${ex.length}`)
  const id = ex[0]?.payload.id
  const shown = id ? p.show(id).stdout : ''
  s.check(/ghost/.test(shown), `excerpt not a ghost: ${shown}`)
  const start = quoteMsg.indexOf('written from memory')
  const end = start + 'written from memory'.length
  s.check(shown.includes(`session ${SESSION}`) && shown.includes('message 3') && shown.includes(`${start}-${end}`) && shown.includes('by user'), `excerpt pointer: ${shown}`)
  const card = p.show('werk-excerpt').stdout
  s.check(id !== undefined && card.includes(`supported-by: #${id}`), `card: ${card}`)
  expect(s.problems).toEqual([])
})

test('67.2', () => {
  p = project(realCard('werk-excerpt'))
  const s = soft()
  const quoted = 'the reader fails instead of guessing'
  const file = recordSession(p, [...filler(4), { role: 'assistant', text: `So ${quoted}, by design.` }, ...filler(1)])
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quoted]).code).toBe(0)
  const id = excerptsOf(p)[0]!.payload.id
  const shown = p.show(id).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(shown)
  s.check(m !== null, `no pointer in show: ${shown}`)
  if (m) {
    s.check(m[1] === SESSION, `session ${m[1]}`)
    const msg = messageAt(file, Number(m[2]))
    s.check(msg.text.slice(Number(m[3]), Number(m[4])) === quoted, `span text: "${msg.text.slice(Number(m[3]), Number(m[4]))}"`)
    s.check(msg.speaker === 'assistant' && m[5] === 'assistant', `speaker ${msg.speaker} / shown ${m[5]}`)
  }
  expect(s.problems).toEqual([])
})

test('67.3', () => {
  p = project(realCard('card'))
  const s = soft()
  recordSession(p, [{ role: 'user', text: 'Make sure the tool never guesses.' }, { role: 'assistant', text: 'Yes.' }])
  const n = p.events().length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  s.check(r.code !== 0, `exit ${r.code}`)
  s.check(/no exact match/.test(out(r)), `error: ${out(r)}`)
  s.check(p.events().length === n, 'event count changed')
  s.check(excerptsOf(p).length === 0 && p.show('card:ex0').code !== 0, 'an excerpt appeared')
  expect(s.problems).toEqual([])
})

test('67.4', () => {
  p = project(realCard('card'))
  const s = soft()
  const msgs = filler(9)
  msgs[3] = { role: 'user', text: 'The reader fails instead of guessing.' }
  msgs[7] = { role: 'user', text: 'Again: it fails instead of guessing, always.' }
  recordSession(p, msgs)
  const n = p.events().length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  s.check(r.code !== 0, `exit ${r.code}`)
  s.check(/\b3\b/.test(r.stderr) && /\b7\b/.test(r.stderr) && /message/.test(r.stderr), `error: ${out(r)}`)
  s.check(p.events().length === n, 'event count changed')
  s.check(excerptsOf(p).length === 0, 'an excerpt appeared')
  expect(s.problems).toEqual([])
})

test('67.5', () => {
  p = project(realCard('card'))
  const s = soft()
  recordSession(p, [{ role: 'user', text: 'Keep one source of truth for the map.' }])
  expect(p.werk(['quote', 'card', SESSION, '--text', 'one source of truth']).code).toBe(0)
  const id = excerptsOf(p)[0]!.payload.id
  const a = p.werk(['accept', id, '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  const shown = p.show(id).stdout
  s.check(shown.includes('state: real') && !/ghost/.test(shown), `excerpt: ${shown}`)
  s.check(p.show('card').stdout.includes(`supported-by: #${id}`), `card: ${p.show('card').stdout}`)
  expect(s.problems).toEqual([])
})

/** The groups of the inbox output: each starts at a line `#id  title`. */
function groups(text: string): Map<string, string[]> {
  const g = new Map<string, string[]>()
  let cur: string[] | undefined
  for (const line of text.split('\n')) {
    const head = /^#(\S+)/.exec(line)
    if (head) g.set(head[1]!, (cur = []))
    else if (line.trim() !== '' && cur) cur.push(line)
  }
  return g
}
const noteTexts = (lines: string[] | undefined) => (lines ?? []).map((l) => /^\s*\[\d+\] \S+ \S+: (.*)$/.exec(l)?.[1] ?? l.trim())

const decidedChat = [
  prop('werk-chat', 'The composer sends a live agent turn', { who: 'me' }),
  acc('werk-chat'),
  kil('werk-chat'),
  { type: 'node.edited', payload: { id: 'werk-chat', noBasis: 'root' } },
  stat('werk-chat', 'decided'),
]

test('68.1', () => {
  p = project(decidedChat)
  const s = soft()
  const n = p.events().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  s.check(r.code === 0, `say exit ${r.code}: ${out(r)}`)
  const added = p.events().slice(n)
  s.check(added.length === 1 && added[0].type === 'note.said' && added[0].payload.id === 'werk-chat', `new events: ${JSON.stringify(added)}`)
  const shown = p.show('werk-chat')
  s.check(shown.stdout.includes('The reply streams over SSE'), `show: ${shown.stdout}`)
  expect(s.problems).toEqual([])
})

test('68.2', () => {
  p = project(realCard('werk-chat'))
  for (const t of ['first', 'second', 'third']) expect(p.werk(['say', 'werk-chat', '--text', t]).code).toBe(0)
  const r = p.werk(['inbox'])
  expect(r.code).toBe(0)
  const g = groups(r.stdout)
  expect([...g.keys()]).toContain('werk-chat')
  expect(noteTexts(g.get('werk-chat'))).toEqual(['first', 'second', 'third'])
})

test('68.3', () => {
  p = project([...realCard('werk-chat'), ...realCard('visual')])
  expect(p.werk(['say', 'werk-chat', '--text', 'chat one']).code).toBe(0)
  expect(p.werk(['say', 'visual', '--text', 'visual one']).code).toBe(0)
  expect(p.werk(['say', 'werk-chat', '--text', 'chat two']).code).toBe(0)
  const g = groups(p.werk(['inbox']).stdout)
  expect(noteTexts(g.get('werk-chat'))).toEqual(['chat one', 'chat two'])
  expect(noteTexts(g.get('visual'))).toContain('visual one')
  expect(noteTexts(g.get('visual'))).not.toContain('chat one')
  expect(noteTexts(g.get('visual'))).not.toContain('chat two')
})

test('68.4', () => {
  p = project([...realCard('visual'), prop('werk-pane', 'The werk pane'), lnk('visual', 'werk-pane', 'depends_on')])
  const s = soft()
  s.check(/ghost/.test(p.show('werk-pane').stdout), 'werk-pane is not a ghost in the Given')
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  s.check(r.code === 0, `say exit ${r.code}: ${out(r)}`)
  const g = groups(p.werk(['inbox']).stdout)
  s.check(noteTexts(g.get('werk-pane')).includes('Describe the pane here'), `inbox groups: ${JSON.stringify([...g])}`)
  expect(s.problems).toEqual([])
})

test('68.5', () => {
  p = project(realCard('werk-chat'))
  const s = soft()
  const size = statSync(p.logFile).size
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  s.check(r.code !== 0, `exit ${r.code}`)
  s.check(/no-such-card/.test(out(r)) && /no node|unknown/.test(out(r)), `output: ${out(r)}`)
  s.check(statSync(p.logFile).size === size, 'log size changed')
  s.check(!p.werk(['inbox']).stdout.includes('lost note'), 'inbox shows the lost note')
  expect(s.problems).toEqual([])
})
