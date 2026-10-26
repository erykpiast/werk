/** Held-out steps 66.x (remove/restore/find), 67.x (quote), 68.x (say/inbox). */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../src/map/events.ts'
import { graphOf, refinesTree, type TreeNode } from '../src/map/graph.ts'
import { readLog } from '../src/map/log.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, killed, linked, logOf, noBasis, proposed, reopened, statusSet, whoSet } from '../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

const logFile = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8').split('\n').filter(Boolean) : [])

/** A real card with a title. A decided one has the decide facts on record. */
const card = (id: string, title: string, opts: { parent?: string; status?: 'open' | 'decided' } = {}): NewEvent[] => {
  const status = opts.status ?? 'open'
  return [
    proposed(id, { title, status: 'open', ...(opts.parent !== undefined && { parent: opts.parent }) }),
    accepted(id),
    ...(status === 'decided' ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
  ]
}

const seed = (...events: NewEvent[]) => {
  p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
}

const ok = (args: string[]) => {
  const r = p.werk(args)
  expect(r.code).toBe(0)
  return r.stdout
}

/** The map as the server sends it: the refines tree of /api/graph. */
const tree = () => refinesTree(graphOf(readLog(logFile())))
const findNode = (nodes: TreeNode[], id: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.node.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}
const childrenIds = (id: string) => findNode(tree(), id)?.children.map((c) => c.node.id) ?? []
const inMap = (id: string) => findNode(tree(), id) !== undefined

// ---------- 66 ----------

test('66.1 An agent removes a bad branch and the log keeps its history', () => {
  seed(
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('index', 'Index', { parent: 'storage' }),
    ...card('eviction', 'Eviction', { parent: 'cache' }),
  )
  const before = logLines()
  ok(['remove', 'cache', '--actor', 'you'])
  expect(ok(['show', 'cache'])).toContain('state: removed')
  expect(ok(['show', 'eviction'])).toContain('state: removed')
  expect(childrenIds('storage')).not.toContain('cache')
  expect(childrenIds('storage')).not.toContain('eviction')
  expect(inMap('cache')).toBe(false)
  expect(inMap('eviction')).toBe(false)
  expect(childrenIds('storage')).toContain('index')
  const removed = ok(['removed'])
  expect(removed).toContain('#cache')
  expect(removed).toContain('Cache')
  const after = logLines()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after).toHaveLength(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', () => {
  seed(
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('eviction', 'Eviction', { parent: 'cache' }),
    ...card('memory-budget', 'Memory budget'),
    linked('cache', 'memory-budget', 'depends_on'),
  )
  ok(['remove', 'cache', '--actor', 'you'])
  ok(['restore', 'cache'])
  const shown = ok(['show', 'cache'])
  expect(shown).not.toContain('removed')
  expect(childrenIds('storage')).toContain('cache')
  expect(childrenIds('cache')).toContain('eviction')
  expect(shown).toContain('link: depends_on -> #memory-budget')
  expect(ok(['removed'])).not.toContain('#cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', () => {
  seed(
    ...card('storage', 'Storage'),
    ...card('bad-layer', 'Bad layer', { parent: 'storage' }),
    ...card('write-path', 'Write path', { parent: 'bad-layer' }),
    ...card('read-path', 'Read path', { parent: 'bad-layer' }),
  )
  ok(['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  expect(ok(['show', 'bad-layer'])).toContain('state: removed')
  expect(childrenIds('storage')).toEqual(expect.arrayContaining(['write-path', 'read-path']))
  expect(ok(['show', 'write-path'])).not.toContain('removed')
  expect(ok(['show', 'read-path'])).not.toContain('removed')
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  seed(
    ...card('storage', 'Storage'),
    ...card('cache', 'Cache', { parent: 'storage' }),
    ...card('index', 'Index', { parent: 'storage' }),
    ...card('backup', 'Backup', { parent: 'storage' }),
    ...card('quota', 'Quota', { parent: 'storage' }),
    ...card('offsite', 'Offsite plan', { status: 'decided' }),
    ...card('limits', 'Limits policy', { status: 'decided' }),
    linked('backup', 'offsite', 'depends_on'),
    linked('quota', 'limits', 'depends_on'),
    reopened('offsite', 'postponed'),
    reopened('limits', 'rejected'),
    ...card('elsewhere', 'Elsewhere'),
  )
  const out = ok(['find', 'storage'])
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
  expect(out).not.toContain('#backup')
  expect(out).not.toContain('#quota')
  expect(out).not.toContain('#elsewhere')
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  seed(...card('storage', 'Storage'), ...card('cache', 'Cache', { parent: 'storage' }), ...card('index', 'Index', { parent: 'storage' }))
  ok(['remove', 'cache', '--actor', 'you'])
  let out = ok(['find', 'storage'])
  expect(out).toContain('#index')
  expect(out).not.toContain('#cache')
  ok(['restore', 'cache'])
  out = ok(['find', 'storage'])
  expect(out).toContain('#cache')
  expect(out).toContain('#index')
})

// ---------- 67 ----------

const SESSION = '7a1b2c3d-0000-4000-8000-000000000067'

const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistantLine = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

const writeTranscript = (lines: string[]) => {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const excerptIds = () => graphOf(readLog(logFile())).nodes.filter((n) => n.kind === 'excerpt').map((n) => n.id)

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  seed(...card('werk-excerpt', 'Excerpts'))
  const msg = 'Every quote in the imported map was written from memory'
  writeTranscript([
    JSON.stringify({ type: 'summary', summary: 's' }),
    userLine('Hello there.'),
    assistantLine('Hi, what do you need?'),
    userLine(msg),
  ])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ids = excerptIds()
  expect(ids).toHaveLength(1)
  const id = ids[0]!
  const graph = graphOf(readLog(logFile()))
  expect(graph.nodes.find((n) => n.id === id)!.proposed).toBe(true)
  const shown = ok(['show', id])
  expect(shown).toContain('state: ghost')
  const start = msg.indexOf('written from memory')
  expect(shown).toContain(`quote: session ${SESSION}, message 3, characters ${start}-${start + 'written from memory'.length}, said by user`)
  expect(ok(['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  seed(...card('werk-excerpt', 'Excerpts'))
  const quoteText = 'the reader never guesses a span'
  const path = writeTranscript([
    userLine('How does the reader work?'),
    assistantLine('It reads each line, and the reader never guesses a span: it fails.'),
  ])
  ok(['quote', 'werk-excerpt', SESSION, '--text', quoteText])
  const id = excerptIds()[0]!
  const shown = ok(['show', id])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, index, from, to, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(index)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  expect(text.slice(Number(from), Number(to))).toBe(quoteText)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', () => {
  seed(...card('werk-excerpt', 'Excerpts'))
  writeTranscript([userLine('Remember: the tool never guesses.')])
  const before = logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines()).toHaveLength(before)
  expect(excerptIds()).toHaveLength(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', () => {
  seed(...card('werk-excerpt', 'Excerpts'))
  writeTranscript([
    JSON.stringify({ type: 'summary', summary: 's' }),
    userLine('one'),
    assistantLine('two'),
    userLine('The tool fails instead of guessing here.'),
    assistantLine('four'),
    userLine('five'),
    assistantLine('six'),
    assistantLine('It fails instead of guessing again.'),
  ])
  const before = logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(logLines()).toHaveLength(before)
  expect(excerptIds()).toHaveLength(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  seed(...card('werk-excerpt', 'Excerpts'))
  writeTranscript([userLine('A ghost excerpt is a proposal.')])
  ok(['quote', 'werk-excerpt', SESSION, '--text', 'ghost excerpt'])
  const id = excerptIds()[0]!
  ok(['accept', id, '--actor', 'you'])
  const shown = ok(['show', id])
  expect(shown).toContain('state: real')
  expect(shown).not.toContain('state: ghost')
  expect(graphOf(readLog(logFile())).nodes.find((n) => n.id === id)!.proposed).toBe(false)
  expect(ok(['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

// ---------- 68 ----------

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  seed(...card('werk-chat', 'The composer sends a live agent turn', { status: 'decided' }))
  const before = logLines().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines()
  expect(after).toHaveLength(before + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toBe('note.said')
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  seed(...card('werk-chat', 'Chat'))
  for (const t of ['first', 'second', 'third']) ok(['say', 'werk-chat', '--text', t])
  const out = ok(['inbox'])
  const head = out.indexOf('#werk-chat')
  expect(head).toBeGreaterThanOrEqual(0)
  const group = out.slice(head)
  const a = group.indexOf(': first')
  const b = group.indexOf(': second')
  const c = group.indexOf(': third')
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(a)
  expect(c).toBeGreaterThan(b)
})

/** The inbox groups, split on blank lines, by the id in the head line. */
const groups = (out: string) =>
  new Map(
    out
      .trim()
      .split('\n\n')
      .map((g) => [g.split('\n')[0]!.split(/\s+/)[0]!, g] as const),
  )

test('68.3 The inbox groups notes by card', () => {
  seed(...card('werk-chat', 'Chat'), ...card('visual', 'Visual'))
  ok(['say', 'werk-chat', '--text', 'chat one'])
  ok(['say', 'visual', '--text', 'visual one'])
  ok(['say', 'werk-chat', '--text', 'chat two'])
  const g = groups(ok(['inbox']))
  const chat = g.get('#werk-chat')!
  const visual = g.get('#visual')!
  expect(chat).toBeDefined()
  expect(visual).toBeDefined()
  expect(chat.indexOf('chat one')).toBeGreaterThan(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  seed(...card('visual', 'Visual'), proposed('werk-pane', { title: 'The pane' }), linked('visual', 'werk-pane', 'depends_on'))
  expect(ok(['show', 'werk-pane'])).toContain('state: ghost')
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = groups(ok(['inbox']))
  expect(g.get('#werk-pane')).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  seed(...card('werk-chat', 'Chat'))
  const before = logLines().length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(logLines()).toHaveLength(before)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})
