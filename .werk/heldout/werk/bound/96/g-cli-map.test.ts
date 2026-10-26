/** Held-out steps 65.x, 66.x, 67.x and 68.x, bound to the werk command line. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../src/map/events.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, killed, linked, logOf, noBasis, proposed, statusSet, whoSet } from '../src/test/map-events.ts'

/** A real card, with the four decide facts and status decided when `decided` is true. */
const card = (id: string, title: string, decided: boolean, parent?: string): NewEvent[] => [
  proposed(id, { title, status: 'open', ...(parent !== undefined && { parent }) }),
  accepted(id),
  ...(decided ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
]

function projectWith(events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])

const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect(r.code).toBe(0)
  return r.stdout
}

/** The entry of one card in the stale list: its head line and its reason line. */
const staleEntry = (out: string, id: string) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^(stale|paused)\\s+#${id}\\s`).test(l))
  return i === -1 ? undefined : `${lines[i]}\n${lines[i + 1] ?? ''}`
}

// ---------- 65: reopen, stale, rederive ----------

test('65.1 A rejected reopen marks only the next hop as stale', () => {
  const p = projectWith([
    ...card('a', 'Card A', true),
    ...card('b', 'Card B', true),
    ...card('c', 'Card C', true),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
  ])
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
  const out = ok(p, ['stale'])
  const b = staleEntry(out, 'b')
  expect(b).toBeDefined()
  expect(b!.startsWith('stale')).toBe(true)
  expect(b).toContain('#a')
  expect(b).toContain('depends_on')
  expect(b).toContain('rejected')
  expect(out).not.toContain('#c')
  const showC = ok(p, ['show', 'c'])
  expect(showC).not.toMatch(/stale/i)
  expect(showC).not.toMatch(/paused/i)
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', () => {
  const p = projectWith([
    ...card('a', 'Card A', true),
    ...card('b', 'Card B', false),
    ...card('c', 'Card C', false),
    ...card('d', 'Card D', true),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
    linked('d', 'c', 'depends_on'),
  ])
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
  const out = ok(p, ['stale'])
  for (const id of ['b', 'c', 'd']) expect(staleEntry(out, id)?.startsWith('paused')).toBe(true)
  expect(ok(p, ['show', 'd'])).toContain('status: decided')
  const d = staleEntry(out, 'd')!
  expect(d).toContain('#a')
  expect(d).toContain('postponed')
  expect(out).not.toMatch(/^stale\s/m)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', () => {
  const p = projectWith([
    ...card('a', 'Card A', true),
    ...card('b', 'Card B', true),
    ...card('c', 'Card C', true),
    linked('c', 'a', 'depends_on'),
    linked('c', 'b', 'refines'),
  ])
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
  const out = ok(p, ['stale'])
  const c = staleEntry(out, 'c')
  expect(c).toBeDefined()
  expect(c!.startsWith('stale')).toBe(true)
  expect(c).toContain('#b')
  expect(c).toContain('rejected')
})

test('65.4 Rederive clears the mark on one card and leaves the others', () => {
  const p = projectWith([
    ...card('a', 'Card A', true),
    ...card('b', 'Card B', true),
    ...card('c', 'Card C', true),
    linked('b', 'a', 'depends_on'),
    linked('c', 'a', 'depends_on'),
  ])
  ok(p, ['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
  const before = ok(p, ['stale'])
  expect(staleEntry(before, 'b')?.startsWith('stale')).toBe(true)
  expect(staleEntry(before, 'c')?.startsWith('stale')).toBe(true)
  ok(p, ['rederive', 'b', 'confirm', '--why', 'b holds'])
  const out = ok(p, ['stale'])
  expect(out).not.toContain('#b')
  const c = staleEntry(out, 'c')!
  expect(c.startsWith('stale')).toBe(true)
  expect(c).toContain('#a')
  expect(c).toContain('rejected')
  expect(ok(p, ['show', 'b'])).not.toMatch(/stale/i)
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', () => {
  const p = projectWith([
    ...card('a', 'Card A', true),
    ...card('b', 'Card B', true),
    ...card('c', 'Card C', true),
    linked('b', 'a', 'depends_on'),
    linked('c', 'b', 'depends_on'),
  ])
  const statusBefore = ok(p, ['show', 'c']).match(/^status: .*$/m)![0]
  ok(p, ['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
  const paused = ok(p, ['stale'])
  expect(staleEntry(paused, 'b')?.startsWith('paused')).toBe(true)
  expect(staleEntry(paused, 'c')?.startsWith('paused')).toBe(true)
  ok(p, ['status', 'a', 'decided'])
  const out = ok(p, ['stale'])
  expect(out).not.toContain('#b')
  expect(out).not.toContain('#c')
  expect(ok(p, ['show', 'c']).match(/^status: .*$/m)![0]).toBe(statusBefore)
})

// ---------- 66: remove, restore, find ----------

const children = (show: string) => [...show.matchAll(/^link: refines <- #(\S+)/gm)].map((m) => m[1])

test('66.1 An agent removes a bad branch and the log keeps its history', () => {
  const p = projectWith([
    ...card('storage', 'Storage', false),
    ...card('cache', 'Cache', false, 'storage'),
    ...card('index', 'Index', false, 'storage'),
    ...card('eviction', 'Eviction', false, 'cache'),
  ])
  const before = logLines(p)
  ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(ok(p, ['show', 'cache'])).toContain('state: removed')
  expect(ok(p, ['show', 'eviction'])).toContain('state: removed')
  const kids = children(ok(p, ['show', 'storage']))
  expect(kids).not.toContain('cache')
  expect(kids).not.toContain('eviction')
  expect(kids).toContain('index')
  expect(ok(p, ['removed'])).toContain('#cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', () => {
  const p = projectWith([
    ...card('storage', 'Storage', false),
    ...card('cache', 'Cache', false, 'storage'),
    ...card('eviction', 'Eviction', false, 'cache'),
    ...card('memory-budget', 'Memory budget', false),
    linked('cache', 'memory-budget', 'depends_on'),
  ])
  ok(p, ['remove', 'cache', '--actor', 'you'])
  ok(p, ['restore', 'cache'])
  const cache = ok(p, ['show', 'cache'])
  expect(cache).not.toContain('removed')
  expect(children(ok(p, ['show', 'storage']))).toContain('cache')
  expect(children(cache)).toContain('eviction')
  expect(cache).toMatch(/link: depends_on -> #memory-budget/)
  expect(ok(p, ['removed'])).not.toContain('#cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', () => {
  const p = projectWith([
    ...card('storage', 'Storage', false),
    ...card('bad-layer', 'Bad layer', false, 'storage'),
    ...card('write-path', 'Write path', false, 'bad-layer'),
    ...card('read-path', 'Read path', false, 'bad-layer'),
  ])
  ok(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  expect(ok(p, ['show', 'bad-layer'])).toContain('state: removed')
  const kids = children(ok(p, ['show', 'storage']))
  expect(kids).toContain('write-path')
  expect(kids).toContain('read-path')
  expect(ok(p, ['show', 'write-path'])).not.toContain('removed')
  expect(ok(p, ['show', 'read-path'])).not.toContain('removed')
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  const p = projectWith([
    ...card('storage', 'Storage', false),
    ...card('cache', 'Cache', false, 'storage'),
    ...card('index', 'Index', false, 'storage'),
    ...card('backup', 'Backup', false, 'storage'),
    ...card('quota', 'Quota', false, 'storage'),
    ...card('later', 'Later', true),
    ...card('wrong', 'Wrong', true),
    ...card('outside', 'Outside', false),
    linked('backup', 'later', 'depends_on'),
    linked('quota', 'wrong', 'depends_on'),
  ])
  ok(p, ['reopen', 'later', '--reason', 'postponed', '--why', 'not now'])
  ok(p, ['reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong'])
  const stale = ok(p, ['stale'])
  expect(staleEntry(stale, 'backup')?.startsWith('paused')).toBe(true)
  expect(staleEntry(stale, 'quota')?.startsWith('stale')).toBe(true)
  const found = ok(p, ['find', 'storage'])
  expect(found).toContain('#cache')
  expect(found).toContain('#index')
  expect(found).not.toContain('#backup')
  expect(found).not.toContain('#quota')
  expect(found).not.toContain('#outside')
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  const p = projectWith([
    ...card('storage', 'Storage', false),
    ...card('cache', 'Cache', false, 'storage'),
    ...card('index', 'Index', false, 'storage'),
  ])
  ok(p, ['remove', 'cache', '--actor', 'you'])
  const found = ok(p, ['find', 'storage'])
  expect(found).toContain('#index')
  expect(found).not.toContain('#cache')
  ok(p, ['restore', 'cache'])
  const again = ok(p, ['find', 'storage'])
  expect(again).toContain('#cache')
  expect(again).toContain('#index')
})

// ---------- 67: quote ----------

const SESSION = '7aa0b1c2-0000-4000-8000-0000000000aa'

const userLine = (text: string) => JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text } })
const assistantLine = (text: string) =>
  JSON.stringify({ type: 'assistant', sessionId: SESSION, message: { role: 'assistant', content: [{ type: 'text', text }] } })

/** A project with a recorded session holding `lines`, one per message index from zero. */
function projectWithSession(lines: string[], cards: NewEvent[]): { p: Project; transcript: string } {
  const p = projectWith(cards)
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const transcript = join(dir, `${SESSION}.jsonl`)
  writeFileSync(transcript, lines.join('\n') + '\n')
  return { p, transcript }
}

const excerptIds = (p: Project) =>
  logLines(p)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')
    .map((e) => e.payload.id as string)

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  const quoteMsg = 'Every quote in the imported map was written from memory'
  const { p } = projectWithSession(
    [JSON.stringify({ type: 'summary', summary: 's' }), assistantLine('Hello.'), userLine(quoteMsg)],
    card('werk-excerpt', 'Excerpts', false),
  )
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const [id] = excerptIds(p)
  expect(id).toBeDefined()
  const shown = ok(p, ['show', id!])
  expect(shown).toContain('state: ghost')
  const start = quoteMsg.indexOf('written from memory')
  expect(shown).toContain(`session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  const quote = 'the fold reads the log from the top'
  const { p, transcript } = projectWithSession(
    [userLine('How does it read?'), assistantLine('Each change is a line, and the fold reads the log from the top.')],
    card('werk-excerpt', 'Excerpts', false),
  )
  expect(p.werk(['quote', 'werk-excerpt', SESSION, '--text', quote]).code).toBe(0)
  const [id] = excerptIds(p)
  const shown = ok(p, ['show', id!])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, index, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(transcript, 'utf8').split('\n')[Number(index)]!)
  const text = line.message.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quote)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', () => {
  const { p } = projectWithSession([userLine('Remember: the tool never guesses.')], card('store', 'Store', false))
  const before = logLines(p).length
  const r = p.werk(['quote', 'store', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p)).toHaveLength(before)
  expect(excerptIds(p)).toEqual([])
  expect(ok(p, ['show', 'store'])).not.toContain('supported-by')
})

test('67.4 A quote that occurs in two messages fails and names both messages', () => {
  const lines = [
    userLine('zero'),
    assistantLine('one'),
    userLine('two'),
    assistantLine('The tool fails instead of guessing here.'),
    userLine('four'),
    assistantLine('five'),
    userLine('six'),
    userLine('It fails instead of guessing again.'),
  ]
  const { p } = projectWithSession(lines, card('store', 'Store', false))
  const before = logLines(p)
  const r = p.werk(['quote', 'store', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(logLines(p)).toEqual(before)
  expect(excerptIds(p)).toEqual([])
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  const { p } = projectWithSession([userLine('Keep the map in an append-only log.')], card('store', 'Store', false))
  expect(p.werk(['quote', 'store', SESSION, '--text', 'append-only log']).code).toBe(0)
  const [id] = excerptIds(p)
  ok(p, ['accept', id!, '--actor', 'you'])
  const shown = ok(p, ['show', id!])
  expect(shown).toContain('state: real')
  expect(shown).not.toContain('ghost')
  expect(ok(p, ['show', 'store'])).toContain(`supported-by: #${id}`)
})

// ---------- 68: say, inbox ----------

/** The lines of one inbox group, from its head line to the next blank line. */
const group = (out: string, id: string) => {
  const blocks = out.split('\n\n')
  return blocks.find((b) => b.startsWith(`#${id} `) || b.startsWith(`#${id}\t`))
}

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  const p = projectWith(card('werk-chat', 'The composer sends a live agent turn', true))
  const before = logLines(p)
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines(p)
  expect(after).toHaveLength(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toMatch(/note/)
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  const p = projectWith(card('werk-chat', 'Chat', false))
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = group(ok(p, ['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const i1 = g!.indexOf(': first')
  const i2 = g!.indexOf(': second')
  const i3 = g!.indexOf(': third')
  expect(i1).toBeGreaterThan(-1)
  expect(i2).toBeGreaterThan(i1)
  expect(i3).toBeGreaterThan(i2)
})

test('68.3 The inbox groups notes by card', () => {
  const p = projectWith([...card('werk-chat', 'Chat', false), ...card('visual', 'Visual', false)])
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const out = ok(p, ['inbox'])
  const chat = group(out, 'werk-chat')!
  expect(chat).toBeDefined()
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  const visual = group(out, 'visual')!
  expect(visual).toBeDefined()
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  const p = projectWith([...card('visual', 'Visual', false), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on')])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']), 'werk-pane')
  expect(g).toBeDefined()
  expect(g).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  const p = projectWith(card('werk-chat', 'Chat', false))
  const size = readFileSync(logFile(p)).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no (node|card)|unknown/i)
  expect(readFileSync(logFile(p)).length).toBe(size)
  expect(ok(p, ['inbox'])).not.toContain('lost note')
})
