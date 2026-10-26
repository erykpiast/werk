/** Held-out steps 67.x (quote an excerpt) and 68.x (notes on cards). */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const SESSION = '11111111-2222-4333-8444-555555555555'

const logPath = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const logLines = (p: Project) => (existsSync(logPath(p)) ? readFileSync(logPath(p), 'utf8').split('\n').filter(Boolean) : [])
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} -> ${r.code}: ${r.stderr}`)
  return r
}

type Msg = { role: 'user' | 'assistant'; text: string }
/** Writes a recorded session transcript; returns the line index of each message. */
function recordSession(p: Project, msgs: Msg[]): number[] {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const lines = [JSON.stringify({ type: 'summary', summary: 's', leafUuid: 'x' })]
  const idx: number[] = []
  msgs.forEach((m, i) => {
    idx.push(lines.length)
    lines.push(
      JSON.stringify({
        type: m.role,
        uuid: `u${i}`,
        sessionId: SESSION,
        message: { role: m.role, content: m.role === 'user' ? m.text : [{ type: 'text', text: m.text }] },
      }),
    )
  })
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')
  return idx
}

// ---------- 67 ----------

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  const p = makeProject()
  ok(p, ['add', 'werk-excerpt', '--title', 'Excerpts quote transcripts'])
  ok(p, ['accept', 'werk-excerpt', '--actor', 'you'])
  const userText = 'Every quote in the imported map was written from memory'
  const idx = recordSession(p, [
    { role: 'user', text: 'Hello there.' },
    { role: 'assistant', text: 'Hi.' },
    { role: 'user', text: userText },
  ])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const m = r.stdout.match(/proposed excerpt (\S+)/)
  expect(m).not.toBeNull()
  const exId = m![1]!
  const ex = ok(p, ['show', exId]).stdout
  expect(ex).toContain('ghost')
  const start = userText.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(ex).toContain(SESSION)
  expect(ex).toContain(`message ${idx[2]}`)
  expect(ex).toContain(`${start}-${end}`)
  expect(ex).toContain('user')
  expect(ok(p, ['show', 'werk-excerpt']).stdout).toMatch(new RegExp(`supported-by:.*#${exId.replace(/[:]/g, ':')}`))
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  const p = makeProject()
  ok(p, ['add', 'werk-excerpt', '--title', 'Excerpts quote transcripts'])
  ok(p, ['accept', 'werk-excerpt', '--actor', 'you'])
  recordSession(p, [
    { role: 'user', text: 'What does the tool do on a miss?' },
    { role: 'assistant', text: 'On a miss the tool stops and says so out loud.' },
  ])
  const quoted = 'stops and says so'
  const r = ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const exId = r.stdout.match(/proposed excerpt (\S+)/)![1]!
  const ex = ok(p, ['show', exId]).stdout
  const q = ex.match(/session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(q).not.toBeNull()
  const [, session, msg, s, e, speaker] = q!
  expect(session).toBe(SESSION)
  const file = join(p.env.HOME!, '.claude', 'projects', '-some-project', `${session}.jsonl`)
  const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(msg)]!)
  const text = typeof line.message.content === 'string' ? line.message.content : line.message.content.map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(s), Number(e))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  const p = makeProject()
  ok(p, ['add', 'card-a', '--title', 'A card'])
  recordSession(p, [{ role: 'assistant', text: 'Remember: the tool never guesses.' }])
  const before = logLines(p)
  const r = p.werk(['quote', 'card-a', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(logLines(p)).toHaveLength(before.length)
  expect(logLines(p).some((l) => JSON.parse(l).payload?.kind === 'excerpt')).toBe(false)
  expect(p.werk(['show', 'card-a:ex0']).code).not.toBe(0)
})

test('67.4 a quote that occurs in two messages fails and names both messages', () => {
  const p = makeProject()
  ok(p, ['add', 'card-a', '--title', 'A card'])
  // index 0 is the summary line; messages at file lines 1..7
  recordSession(p, [
    { role: 'user', text: 'm1' },
    { role: 'assistant', text: 'm2' },
    { role: 'user', text: 'The tool fails instead of guessing.' }, // line 3
    { role: 'assistant', text: 'm4' },
    { role: 'user', text: 'm5' },
    { role: 'assistant', text: 'm6' },
    { role: 'assistant', text: 'It fails instead of guessing, always.' }, // line 7
  ])
  const before = logLines(p)
  const r = p.werk(['quote', 'card-a', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(out).toContain('3, 7')
  expect(logLines(p)).toEqual(before)
  expect(p.werk(['show', 'card-a:ex0']).code).not.toBe(0)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  const p = makeProject()
  ok(p, ['add', 'card-a', '--title', 'A card'])
  ok(p, ['accept', 'card-a', '--actor', 'you'])
  recordSession(p, [{ role: 'assistant', text: 'Keep the map in an append-only log.' }])
  const exId = ok(p, ['quote', 'card-a', SESSION, '--text', 'append-only log']).stdout.match(/proposed excerpt (\S+)/)![1]!
  expect(ok(p, ['show', exId]).stdout).toContain('ghost')
  ok(p, ['accept', exId, '--actor', 'you'])
  const ex = ok(p, ['show', exId]).stdout
  expect(ex).not.toContain('ghost')
  expect(ok(p, ['show', 'card-a']).stdout).toContain(`supported-by: #${exId}`)
})

// ---------- 68 ----------

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  const seed = logOf(proposed('werk-chat', { title: 'The composer sends a live agent turn', status: 'decided' }), accepted('werk-chat'))
  writeFileSync(logPath(p), seed.map((e) => JSON.stringify(e)).join('\n') + '\n')
  expect(ok(p, ['show', 'werk-chat']).stdout).toContain('decided')
  const before = logLines(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(p, ['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  const p = makeProject()
  ok(p, ['add', 'werk-chat', '--title', 'Chat'])
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const out = ok(p, ['inbox']).stdout
  expect(out).toContain('#werk-chat')
  const i1 = out.indexOf(': first'), i2 = out.indexOf(': second'), i3 = out.indexOf(': third')
  expect(i1).toBeGreaterThan(out.indexOf('#werk-chat'))
  expect(i1).toBeLessThan(i2)
  expect(i2).toBeLessThan(i3)
})

test('68.3 the inbox groups notes by card', () => {
  const p = makeProject()
  ok(p, ['add', 'werk-chat', '--title', 'Chat'])
  ok(p, ['add', 'visual', '--title', 'Visual'])
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const groups = ok(p, ['inbox']).stdout.split(/\n\s*\n/)
  const chat = groups.find((g) => g.startsWith('#werk-chat'))!
  const visual = groups.find((g) => g.startsWith('#visual'))!
  expect(chat).toBeDefined()
  expect(visual).toBeDefined()
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat one')).toBeLessThan(chat.indexOf('chat two'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  const p = makeProject()
  ok(p, ['add', 'visual', '--title', 'Visual', '--body', 'The visual layer'])
  ok(p, ['accept', 'visual', '--actor', 'you'])
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on', '--why', 'needs it'])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const out = ok(p, ['inbox']).stdout
  const group = out.split(/\n\s*\n/).find((g) => g.startsWith('#werk-pane'))
  expect(group).toBeDefined()
  expect(group!).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  const p = makeProject()
  ok(p, ['add', 'werk-chat', '--title', 'Chat'])
  const size = readFileSync(logPath(p)).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no-such-card')
  expect(readFileSync(logPath(p)).length).toBe(size)
  expect(ok(p, ['inbox']).stdout).not.toContain('lost note')
})
