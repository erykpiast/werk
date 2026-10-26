import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { assistantLine, filler, makeMap, userLine } from './helpers.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
const map = () => {
  const m = makeMap()
  cleanups.push(m.cleanup)
  return m
}
const ok = (r: { code: number; stderr: string }) => expect(r.code, r.stderr).toBe(0)

/** Checks that exactly one line was appended and every earlier line is unchanged. */
const expectOneAppended = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

test('62.1', () => {
  const m = map()
  ok(m.werk('add', 'seed-a', '--title', 'Seed A'))
  ok(m.werk('add', 'seed-b', '--title', 'Seed B'))
  ok(m.werk('accept', 'seed-a', '--actor', 'you'))
  let before = m.logLines()
  expect(before.length).toBeGreaterThan(0)

  const add = m.werk('add', 'use-log', '--title', 'Use a log', '--body', 'The map is a log.', '--why', 'It keeps history.')
  ok(add)
  expect(add.stdout).toContain('proposed')
  let after = m.logLines()
  expectOneAppended(before, after)

  const show = m.werk('show', 'use-log')
  ok(show)
  expect(show.stdout).toContain('Use a log')
  expect(show.stdout).toContain('The map is a log.')
  expect(show.stdout).toContain('It keeps history.')
  expect(show.stdout).toMatch(/ghost/)

  before = after
  ok(m.werk('accept', 'use-log', '--actor', 'you'))
  after = m.logLines()
  expectOneAppended(before, after)
  const show2 = m.werk('show', 'use-log')
  ok(show2)
  expect(show2.stdout).toContain('Use a log')
  expect(show2.stdout).toContain('The map is a log.')
  expect(show2.stdout).toContain('It keeps history.')
  expect(show2.stdout).toContain('state: real')
  expect(show2.stdout).not.toMatch(/ghost/)
})

test('62.2', () => {
  const m = map()
  ok(m.werk('add', 'c1', '--title', 'Card one'))
  const before = m.logText()
  const r = m.werk('accept', 'c1')
  expect(r.code).not.toBe(0)
  expect(m.logText()).toBe(before)
  expect(m.werk('show', 'c1').stdout).toMatch(/ghost/)
  ok(m.werk('accept', 'c1', '--actor', 'you'))
  const show = m.werk('show', 'c1').stdout
  expect(show).toContain('state: real')
  expect(show).not.toMatch(/ghost/)
})

test('62.3', () => {
  const m = map()
  ok(m.werk('add', 'c1', '--title', 'Use a log'))
  let before = m.logText()
  expect(m.werk('edit', 'c1', '--body', 'new body').code).not.toBe(0)
  expect(m.logText()).toBe(before)
  expect(m.werk('retitle', 'c1', '--title', 'Use an append-only log').code).not.toBe(0)
  expect(m.logText()).toBe(before)
  expect(m.werk('add', 'c1', '--title', 'Something else').code).not.toBe(0)
  expect(m.logText()).toBe(before)
  const show = m.werk('show', 'c1').stdout
  expect(show).toContain('Use a log')
  expect(show).toMatch(/ghost/)
})

test('62.4', () => {
  const m = map()
  ok(m.werk('add', 'c1', '--title', 'Use a log'))
  ok(m.werk('accept', 'c1', '--actor', 'you'))
  const before = m.logLines()
  ok(m.werk('retitle', 'c1', '--title', 'Use an append-only log'))
  const after = m.logLines()
  expectOneAppended(before, after)
  const show = m.werk('show', 'c1').stdout
  expect(show).toContain('Use an append-only log')
  expect(show).not.toContain('Use a log')
  const earlier = after.slice(0, -1).find((l) => l.includes('"Use a log"'))
  expect(earlier).toBeDefined()
  ok(m.werk('edit', 'c1', '--body', 'A new body text'))
  const show2 = m.werk('show', 'c1').stdout
  expect(show2).toContain('A new body text')
  expect(show2).toContain('Use an append-only log')
})

test('62.5', () => {
  const m = map()
  ok(m.werk('add', 'card', '--title', 'The card'))
  ok(m.werk('accept', 'card', '--actor', 'you'))
  const adds: [string, string[]][] = [
    ['opt', ['--kind', 'option', '--title', 'Use a database', '--parent', 'card', '--why-not', 'Too heavy']],
    ['src', ['--kind', 'source', '--title', 'The design doc', '--who', 'Ada']],
    ['exc', ['--kind', 'excerpt', '--title', 'Logs never lie', '--body', 'quoted words']],
  ]
  for (const [id, args] of adds) {
    const before = m.logLines()
    const r = m.werk('add', id, ...args)
    ok(r)
    expect(r.stdout).toContain('proposed')
    expectOneAppended(before, m.logLines())
  }
  const opt = m.werk('show', 'opt').stdout
  expect(opt).toContain('Use a database')
  expect(opt).toContain('Too heavy')
  expect(opt).toMatch(/ghost/)
  const src = m.werk('show', 'src').stdout
  expect(src).toContain('The design doc')
  expect(src).toContain('Ada')
  expect(src).toMatch(/ghost/)
  const exc = m.werk('show', 'exc').stdout
  expect(exc).toContain('Logs never lie')
  expect(exc).toContain('quoted words')
  expect(exc).toMatch(/ghost/)

  ok(m.werk('accept', 'opt', '--actor', 'you'))
  const opt2 = m.werk('show', 'opt').stdout
  expect(opt2).toContain('state: real')
  expect(opt2).not.toMatch(/ghost/)
  expect(opt2).toContain('why-not: Too heavy')
  expect(m.werk('show', 'src').stdout).toMatch(/ghost/)
  expect(m.werk('show', 'exc').stdout).toMatch(/ghost/)
})

const SESSION = 'sess-0001'

test('67.1', () => {
  const m = map()
  ok(m.werk('add', 'werk-excerpt', '--title', 'Excerpts quote transcripts'))
  ok(m.werk('accept', 'werk-excerpt', '--actor', 'you'))
  const msg = 'Every quote in the imported map was written from memory'
  m.writeSession(SESSION, [filler(), assistantLine('Hello there'), userLine(msg), assistantLine('Noted.')])
  const r = m.werk('quote', 'werk-excerpt', SESSION, '--text', 'written from memory')
  ok(r)
  const last = JSON.parse(m.logLines().at(-1)!)
  const exId = last.payload.id as string
  const show = m.werk('show', exId).stdout
  expect(show).toMatch(/ghost/)
  const start = msg.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(show).toContain(SESSION)
  expect(show).toContain('message 2')
  expect(show).toContain('user')
  expect(show).toContain(`${start}-${end}`)
  const card = m.werk('show', 'werk-excerpt').stdout
  expect(card).toMatch(new RegExp(`supported.by: .*#${exId}`))
})

test('67.2', () => {
  const m = map()
  ok(m.werk('add', 'werk-excerpt', '--title', 'Excerpts quote transcripts'))
  ok(m.werk('accept', 'werk-excerpt', '--actor', 'you'))
  const quoted = 'the pointer finds the words again'
  const path = m.writeSession(SESSION, [
    filler(),
    userLine('Can a reader find a quote?'),
    assistantLine(`Yes: ${quoted}, every time.`),
  ])
  ok(m.werk('quote', 'werk-excerpt', SESSION, '--text', quoted))
  const exId = JSON.parse(m.logLines().at(-1)!).payload.id as string
  const show = m.werk('show', exId).stdout
  const found = show.match(/session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(found).not.toBeNull()
  const [, session, idx, s, e, speaker] = found!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(idx)]!)
  const text = (line.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(s), Number(e))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3', () => {
  const m = map()
  ok(m.werk('add', 'card', '--title', 'A card'))
  m.writeSession(SESSION, [userLine('I want this: the tool never guesses.')])
  const before = m.logLines().length
  const r = m.werk('quote', 'card', SESSION, '--text', 'the tool never gueses')
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/no exact match/)
  expect(m.logLines().length).toBe(before)
  expect(m.logText()).not.toContain('"excerpt"')
})

test('67.4', () => {
  const m = map()
  ok(m.werk('add', 'card', '--title', 'A card'))
  const lines: unknown[] = [filler(), filler(), filler(), userLine('It fails instead of guessing.'), filler(), filler(), filler(), assistantLine('Yes, it fails instead of guessing.')]
  m.writeSession(SESSION, lines)
  const before = m.logText()
  const r = m.werk('quote', 'card', SESSION, '--text', 'fails instead of guessing')
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(out).toMatch(/message/)
  expect(m.logText()).toBe(before)
  expect(m.logText()).not.toContain('"excerpt"')
})

test('67.5', () => {
  const m = map()
  ok(m.werk('add', 'card', '--title', 'A card'))
  ok(m.werk('accept', 'card', '--actor', 'you'))
  m.writeSession(SESSION, [userLine('Quote me on this line.')])
  ok(m.werk('quote', 'card', SESSION, '--text', 'Quote me on this line.'))
  const exId = JSON.parse(m.logLines().at(-1)!).payload.id as string
  expect(m.werk('show', exId).stdout).toMatch(/ghost/)
  ok(m.werk('accept', exId, '--actor', 'you'))
  const show = m.werk('show', exId).stdout
  expect(show).toContain('state: real')
  expect(show).not.toMatch(/ghost/)
  expect(m.werk('show', 'card').stdout).toMatch(new RegExp(`supported.by: .*#${exId}`))
})

/** The lines of one inbox group, from its head to the next blank line. */
const group = (inbox: string, id: string) => {
  const lines = inbox.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`#${id} `))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.trim() === '' || l.startsWith('#'))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

test('68.1', () => {
  const m = map()
  ok(m.werk('add', 'werk-chat', '--title', 'The composer sends a live agent turn', '--status', 'decided'))
  ok(m.werk('accept', 'werk-chat', '--actor', 'you'))
  const before = m.logLines()
  ok(m.werk('say', 'werk-chat', '--text', 'The reply streams over SSE'))
  const after = m.logLines()
  expect(after.length).toBe(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(m.werk('show', 'werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2', () => {
  const m = map()
  ok(m.werk('add', 'werk-chat', '--title', 'Chat'))
  for (const t of ['first', 'second', 'third']) ok(m.werk('say', 'werk-chat', '--text', t))
  const r = m.werk('inbox')
  ok(r)
  const g = group(r.stdout, 'werk-chat')
  expect(g).toBeDefined()
  const i1 = g!.indexOf(': first'), i2 = g!.indexOf(': second'), i3 = g!.indexOf(': third')
  expect(i1).toBeGreaterThan(-1)
  expect(i2).toBeGreaterThan(i1)
  expect(i3).toBeGreaterThan(i2)
})

test('68.3', () => {
  const m = map()
  ok(m.werk('add', 'werk-chat', '--title', 'Chat'))
  ok(m.werk('add', 'visual', '--title', 'Visual'))
  ok(m.werk('say', 'werk-chat', '--text', 'chat one'))
  ok(m.werk('say', 'visual', '--text', 'visual one'))
  ok(m.werk('say', 'werk-chat', '--text', 'chat two'))
  const r = m.werk('inbox')
  ok(r)
  const chat = group(r.stdout, 'werk-chat')!
  const visual = group(r.stdout, 'visual')!
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4', () => {
  const m = map()
  ok(m.werk('add', 'werk-pane', '--title', 'The pane'))
  ok(m.werk('add', 'visual', '--title', 'Visual', '--parent', 'werk-pane'))
  expect(m.werk('show', 'werk-pane').stdout).toMatch(/ghost/)
  ok(m.werk('say', 'werk-pane', '--text', 'Describe the pane here'))
  const r = m.werk('inbox')
  ok(r)
  expect(group(r.stdout, 'werk-pane')).toContain('Describe the pane here')
})

test('68.5', () => {
  const m = map()
  ok(m.werk('add', 'werk-chat', '--title', 'Chat'))
  const size = m.logText().length
  const r = m.werk('say', 'no-such-card', '--text', 'lost note')
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no-such-card')
  expect(r.stderr + r.stdout).toMatch(/no node|unknown/i)
  expect(m.logText().length).toBe(size)
  expect(m.werk('inbox').stdout).not.toContain('lost note')
})
