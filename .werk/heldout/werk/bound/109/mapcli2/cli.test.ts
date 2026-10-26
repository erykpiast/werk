/** Held-out steps 66.x (remove, restore, find), 67.x (quote), 68.x (say, inbox), run as a process. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'

const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r.stdout
}
const logPath = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const logLines = (p: Project) => (existsSync(logPath(p)) ? readFileSync(logPath(p), 'utf8').split('\n').filter(Boolean) : [])

function card(p: Project, id: string, title: string, parent?: string) {
  ok(p, ['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
  ok(p, ['accept', id, '--actor', 'you'])
}
function decided(p: Project, id: string, title = `Card ${id}`, parent?: string) {
  card(p, id, title, parent)
  ok(p, ['edit', id, '--who', 'me', '--no-basis', 'a test card'])
  ok(p, ['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  ok(p, ['status', id, 'decided'])
}
/** True when the show output of `parent` lists `child` as a refines child (the map tree). */
const under = (p: Project, child: string, parent: string) => ok(p, ['show', parent]).includes(`link: refines <- #${child}`)
const findIds = (out: string) => [...out.matchAll(/#(\S+)/g)].map((m) => m[1])

// ---------- 66 ----------

test('66.1 An agent removes a bad branch and the log keeps its history', () => {
  const p = makeProject()
  card(p, 'storage', 'Storage')
  card(p, 'cache', 'Cache', 'storage')
  card(p, 'index', 'Index', 'storage')
  card(p, 'eviction', 'Eviction', 'cache')
  const before = logLines(p)

  ok(p, ['remove', 'cache', '--actor', 'you'])
  expect(ok(p, ['show', 'cache'])).toContain('state: removed')
  expect(ok(p, ['show', 'eviction'])).toContain('state: removed')
  expect(under(p, 'cache', 'storage')).toBe(false)
  expect(ok(p, ['show', 'storage'])).not.toContain('#eviction')
  expect(under(p, 'index', 'storage')).toBe(true)
  expect(ok(p, ['removed'])).toContain('#cache')
  const after = logLines(p)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.length).toBe(before.length + 1)
})

test('66.2 A person restores a removed card and its subtree with their links', () => {
  const p = makeProject()
  card(p, 'storage', 'Storage')
  card(p, 'cache', 'Cache', 'storage')
  card(p, 'eviction', 'Eviction', 'cache')
  card(p, 'memory-budget', 'Memory budget')
  ok(p, ['link', 'cache', 'memory-budget', '--type', 'depends_on'])
  ok(p, ['remove', 'cache', '--actor', 'you'])

  ok(p, ['restore', 'cache'])
  const cache = ok(p, ['show', 'cache'])
  expect(cache).not.toContain('state: removed')
  expect(under(p, 'cache', 'storage')).toBe(true)
  expect(under(p, 'eviction', 'cache')).toBe(true)
  expect(cache).toContain('link: depends_on -> #memory-budget')
  expect(ok(p, ['removed'])).not.toContain('#cache')
})

test('66.3 An agent removes a bad parent but keeps its good children', () => {
  const p = makeProject()
  card(p, 'storage', 'Storage')
  card(p, 'bad-layer', 'Bad layer', 'storage')
  card(p, 'write-path', 'Write path', 'bad-layer')
  card(p, 'read-path', 'Read path', 'bad-layer')

  ok(p, ['remove', 'bad-layer', '--actor', 'you', '--reparent'])
  expect(ok(p, ['show', 'bad-layer'])).toContain('state: removed')
  expect(under(p, 'write-path', 'storage')).toBe(true)
  expect(under(p, 'read-path', 'storage')).toBe(true)
  expect(ok(p, ['show', 'write-path'])).toContain('parent: #storage')
  expect(ok(p, ['show', 'read-path'])).toContain('parent: #storage')
  expect(ok(p, ['show', 'write-path'])).not.toContain('state: removed')
  expect(ok(p, ['show', 'read-path'])).not.toContain('state: removed')
})

test('66.4 An agent finds the open cards it can work on in a subtree', () => {
  const p = makeProject()
  card(p, 'storage', 'Storage')
  for (const [id, t] of [['cache', 'Cache'], ['index', 'Index'], ['backup', 'Backup'], ['quota', 'Quota']]) card(p, id!, t!, 'storage')
  decided(p, 'later', 'Later thing')
  decided(p, 'wrong', 'Wrong thing')
  ok(p, ['link', 'backup', 'later', '--type', 'depends_on'])
  ok(p, ['link', 'quota', 'wrong', '--type', 'depends_on'])
  ok(p, ['reopen', 'later', '--reason', 'postponed', '--why', 'later'])
  ok(p, ['reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong'])
  const marks = ok(p, ['stale'])
  expect(marks).toMatch(/paused\s+#backup/)
  expect(marks).toMatch(/stale\s+#quota/)
  card(p, 'outside', 'Outside')

  const ids = findIds(ok(p, ['find', 'storage']))
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
  expect(ids).not.toContain('backup')
  expect(ids).not.toContain('quota')
  expect(ids).not.toContain('outside')
})

test('66.5 A removed branch drops out of the find result and comes back after a restore', () => {
  const p = makeProject()
  card(p, 'storage', 'Storage')
  card(p, 'cache', 'Cache', 'storage')
  card(p, 'index', 'Index', 'storage')
  ok(p, ['remove', 'cache', '--actor', 'you'])

  let ids = findIds(ok(p, ['find', 'storage']))
  expect(ids).toContain('index')
  expect(ids).not.toContain('cache')
  ok(p, ['restore', 'cache'])
  ids = findIds(ok(p, ['find', 'storage']))
  expect(ids).toContain('cache')
  expect(ids).toContain('index')
})

// ---------- 67 ----------

const SESSION = '7a1b2c3d-0000-4000-8000-000000000067'
const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const assistantLine = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

/** Writes a transcript of the given lines (index = line number from zero) for SESSION. */
function transcript(p: Project, lines: string[]): string {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-worktree')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}
const summary = JSON.stringify({ type: 'summary', summary: 'held-out session' })
const excerptIds = (p: Project) =>
  logLines(p)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === 'node.proposed' && e.payload.kind === 'excerpt')

test('67.1 A quote found once in a transcript becomes a ghost excerpt on the citing card', () => {
  const p = makeProject()
  card(p, 'werk-excerpt', 'Excerpts')
  const msg = 'Every quote in the imported map was written from memory'
  transcript(p, [summary, assistantLine('Hello, what is the problem?'), userLine(msg)])

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = excerptIds(p)
  expect(ex).toHaveLength(1)
  const id = ex[0].payload.id as string
  const shown = ok(p, ['show', id])
  expect(shown).toContain('state: ghost')
  const start = msg.indexOf('written from memory')
  const end = start + 'written from memory'.length
  expect(shown).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${end}, said by user`)
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

test('67.2 The excerpt lets the person find the quote again in the transcript', () => {
  const p = makeProject()
  card(p, 'werk-excerpt', 'Excerpts')
  const path = transcript(p, [summary, userLine('How sure is the tool?'), assistantLine('The reader is strict: the tool never guesses a span.')])
  const quoted = 'the tool never guesses'
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
  const id = excerptIds(p)[0].payload.id as string

  const shown = ok(p, ['show', id])
  const m = shown.match(/quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/)
  expect(m).not.toBeNull()
  const [, session, index, start, end, speaker] = m!
  expect(session).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(index)]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  expect(text.slice(Number(start), Number(end))).toBe(quoted)
  expect(line.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
})

test('67.3 A quote with one changed character fails and changes nothing', () => {
  const p = makeProject()
  card(p, 'werk-excerpt', 'Excerpts')
  transcript(p, [summary, userLine('Promise me one thing.'), assistantLine('Yes: the tool never guesses.')])
  const before = logLines(p).length

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines(p).length).toBe(before)
  expect(excerptIds(p)).toHaveLength(0)
  expect(p.werk(['show', 'werk-excerpt:ex0']).code).not.toBe(0)
})

test('67.4 A quote that occurs in two messages fails and names both messages', () => {
  const p = makeProject()
  card(p, 'werk-excerpt', 'Excerpts')
  const lines = [
    summary,
    userLine('one'),
    assistantLine('two'),
    userLine('The reader fails instead of guessing.'),
    assistantLine('four'),
    userLine('five'),
    assistantLine('six'),
    assistantLine('Right, it fails instead of guessing every time.'),
  ]
  transcript(p, lines)
  const before = logLines(p).length

  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toMatch(/\b3\b/)
  expect(r.stderr).toMatch(/\b7\b/)
  expect(logLines(p).length).toBe(before)
  expect(excerptIds(p)).toHaveLength(0)
})

test('67.5 A ghost excerpt is accepted the same way as every other ghost', () => {
  const p = makeProject()
  card(p, 'werk-excerpt', 'Excerpts')
  transcript(p, [summary, userLine('Keep every quote exact.')])
  ok(p, ['quote', 'werk-excerpt', SESSION, '--text', 'every quote exact'])
  const id = excerptIds(p)[0].payload.id as string
  expect(ok(p, ['show', id])).toContain('state: ghost')

  ok(p, ['accept', id, '--actor', 'you'])
  const shown = ok(p, ['show', id])
  expect(shown).toContain('state: real')
  expect(shown).not.toContain('ghost')
  expect(ok(p, ['show', 'werk-excerpt'])).toContain(`supported-by: #${id}`)
})

// ---------- 68 ----------

/** The lines of the inbox group of one card: from its head line to the next blank line. */
function group(inbox: string, id: string): string[] | undefined {
  const lines = inbox.split('\n')
  const at = lines.findIndex((l) => l.startsWith(`#${id} `))
  if (at === -1) return undefined
  const out: string[] = []
  for (let i = at; i < lines.length && lines[i] !== ''; i++) out.push(lines[i]!)
  return out
}

test('68.1 An agent writes a note on a card and sees it on the card', () => {
  const p = makeProject()
  decided(p, 'werk-chat', 'The composer sends a live agent turn')
  const before = logLines(p).length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const lines = logLines(p)
  expect(lines.length).toBe(before + 1)
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({ type: 'note.said', payload: { id: 'werk-chat' } })
  expect(ok(p, ['show', 'werk-chat'])).toContain('The reply streams over SSE')
})

test('68.2 An agent reads a whole card thread in order from the inbox', () => {
  const p = makeProject()
  card(p, 'werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
  const g = group(ok(p, ['inbox']), 'werk-chat')
  expect(g).toBeDefined()
  const text = g!.join('\n')
  const at = ['first', 'second', 'third'].map((t) => text.indexOf(`: ${t}`))
  expect(at.every((i) => i > 0)).toBe(true)
  expect(at[0]! < at[1]! && at[1]! < at[2]!).toBe(true)
})

test('68.3 The inbox groups notes by card', () => {
  const p = makeProject()
  card(p, 'werk-chat', 'Chat')
  card(p, 'visual', 'Visual')
  ok(p, ['say', 'werk-chat', '--text', 'chat one'])
  ok(p, ['say', 'visual', '--text', 'visual one'])
  ok(p, ['say', 'werk-chat', '--text', 'chat two'])
  const inbox = ok(p, ['inbox'])
  const chat = group(inbox, 'werk-chat')!.join('\n')
  const visual = group(inbox, 'visual')!.join('\n')
  expect(chat.indexOf('chat one')).toBeGreaterThan(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(visual).toContain('visual one')
  expect(visual).not.toContain('chat one')
  expect(visual).not.toContain('chat two')
})

test('68.4 An agent writes a note on a ghost card', () => {
  const p = makeProject()
  card(p, 'visual', 'Visual')
  ok(p, ['add', 'werk-pane', '--title', 'The pane'])
  ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  expect(ok(p, ['show', 'werk-pane'])).toContain('state: ghost')

  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = group(ok(p, ['inbox']), 'werk-pane')
  expect(g).toBeDefined()
  expect(g!.join('\n')).toContain('Describe the pane here')
})

test('68.5 A note on an unknown card fails and changes nothing', () => {
  const p = makeProject()
  card(p, 'werk-chat', 'Chat')
  const size = statSync(logPath(p)).size
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
  expect(statSync(logPath(p)).size).toBe(size)
  expect(ok(p, ['inbox'])).not.toContain('lost note')
})
