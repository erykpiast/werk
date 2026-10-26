/** Held-out steps 62, 63, 67, 68 and 80, run through the werk command line in a temporary project. */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { makeProject, type Project } from '../src/test/harness.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')

let p: Project
afterEach(() => p?.cleanup())

const logFile = () => join(p.dir, '.werk', 'log.jsonl')
const logLines = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8').split('\n').filter(Boolean) : [])
const events = () => logLines().map((l) => JSON.parse(l))

function ok(args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}
const show = (id: string) => p.werk(['show', id])
const realCard = (id: string, title: string, extra: string[] = []) => {
  ok(['add', id, '--title', title, ...extra])
  ok(['accept', id, '--actor', 'you'])
}
/** Runs a command and checks that it appended exactly one event at the end, earlier lines unchanged. */
function appendsOne(args: string[]) {
  const before = logLines()
  const r = p.werk(args)
  const after = logLines()
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
  return r
}
function appendsNone(args: string[]) {
  const before = logLines()
  const r = p.werk(args)
  expect(logLines()).toEqual(before)
  return r
}

// ---------- 62 ----------

test('62.1 an agent proposes a card and a person accepts it', () => {
  p = makeProject()
  realCard('root', 'The root')
  ok(['add', 'other', '--title', 'Other', '--parent', 'root'])
  expect(logLines().length).toBeGreaterThan(0)

  const add = appendsOne(['add', 'use-log', '--title', 'Use a log', '--body', 'Every change is a line.', '--why', 'Nothing is lost.'])
  expect(add.code).toBe(0)
  expect(add.stdout).toContain('proposed')

  const s1 = show('use-log').stdout
  expect(s1).toContain('Use a log')
  expect(s1).toContain('Every change is a line.')
  expect(s1).toContain('Nothing is lost.')
  expect(s1).toContain('ghost')

  const acc = appendsOne(['accept', 'use-log', '--actor', 'you'])
  expect(acc.code).toBe(0)
  const s2 = show('use-log').stdout
  expect(s2).toContain('Use a log')
  expect(s2).toContain('Every change is a line.')
  expect(s2).toContain('Nothing is lost.')
  expect(s2).toContain('state: real')
  expect(s2).not.toContain('ghost')
})

test('62.2 an accept without the claim refuses and leaves the ghost', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'A card'])
  const r = appendsNone(['accept', 'c'])
  expect(r.code).not.toBe(0)
  expect(show('c').stdout).toContain('ghost')
  ok(['accept', 'c', '--actor', 'you'])
  expect(show('c').stdout).toContain('state: real')
})

test('62.3 the words of a ghost are frozen', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  expect(appendsNone(['edit', 'c', '--body', 'new body']).code).not.toBe(0)
  expect(appendsNone(['retitle', 'c', '--title', 'Use an append-only log']).code).not.toBe(0)
  expect(appendsNone(['add', 'c', '--title', 'A different title']).code).not.toBe(0)
  const s = show('c').stdout
  expect(s).toContain('Use a log')
  expect(s).toContain('ghost')
})

test('62.4 a retitle on a real card shows only the new title and keeps the old one in the log', () => {
  p = makeProject()
  ok(['add', 'c', '--title', 'Use a log'])
  ok(['accept', 'c', '--actor', 'you'])
  const before = logLines()
  const r = appendsOne(['retitle', 'c', '--title', 'Use an append-only log'])
  expect(r.code).toBe(0)
  const s = show('c').stdout
  expect(s).toContain('Use an append-only log')
  expect(s).not.toContain('Use a log')
  const raw = readFileSync(logFile(), 'utf8').split('\n')
  const idx = raw.findIndex((l) => l.includes('"Use a log"'))
  expect(idx).toBeGreaterThanOrEqual(0)
  expect(idx).toBeLessThan(before.length)
  ok(['edit', 'c', '--body', 'The new body text'])
  const s2 = show('c').stdout
  expect(s2).toContain('The new body text')
  expect(s2).toContain('Use an append-only log')
})

test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
  p = makeProject()
  realCard('card', 'The card')
  const adds: [string, string[], string[]][] = [
    ['opt', ['--kind', 'option', '--title', 'Use files', '--why-not', 'Too slow to scan', '--parent', 'card'], ['Use files', 'Too slow to scan']],
    ['src', ['--kind', 'source', '--title', 'Benchmark notes', '--body', 'Numbers from a run'], ['Benchmark notes', 'Numbers from a run']],
    ['exc', ['--kind', 'excerpt', '--title', 'A quoted line', '--body', 'said once'], ['A quoted line', 'said once']],
  ]
  for (const [id, flags] of adds) {
    const r = appendsOne(['add', id, ...flags])
    expect(r.stdout).toContain('proposed')
  }
  for (const [id, , fields] of adds) {
    const s = show(id).stdout
    for (const f of fields) expect(s).toContain(f)
    expect(s).toContain('ghost')
  }
  ok(['accept', 'opt', '--actor', 'you'])
  const o = show('opt').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('Too slow to scan')
  expect(show('src').stdout).toContain('ghost')
  expect(show('exc').stdout).toContain('ghost')
})

// ---------- 63 ----------

test('63.1 a link to a ghost is held, and goes live on accept with no extra link event', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
  expect(show('use-sqlite').stdout).toMatch(/link: depends_on -> #storage \(held\)/)
  const st = show('storage').stdout
  expect(st).not.toMatch(/link: depends_on <- #use-sqlite(?! \(held\))/)
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const s = show('use-sqlite').stdout
  expect(s).toContain('link: depends_on -> #storage')
  expect(s).not.toContain('(held)')
  const links = events().filter((e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage')
  expect(links).toHaveLength(1)
})

test('63.2 accepting a ghost child also accepts its ghost parent, but not a ghost it depends on', () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
  ok(['link', 'magic-links', 'email-service', '--type', 'depends_on'])
  ok(['accept', 'magic-links', '--actor', 'you'])
  expect(show('magic-links').stdout).toContain('state: real')
  const a = show('auth').stdout
  expect(a).toContain('state: real')
  expect(a).toContain('parent: #platform')
  expect(show('email-service').stdout).toContain('ghost')
  expect(show('magic-links').stdout).toContain('link: depends_on -> #email-service (held)')
})

test('63.3 an accept takes the card own ghost options and sources with it', () => {
  p = makeProject()
  realCard('storage', 'Storage')
  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
  ok(['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'])
  ok(['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'])
  ok(['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes'])
  ok(['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by'])
  const st = p.werk(['status', 'use-sqlite', 'decided'])
  const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])
  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const s = show('use-sqlite').stdout
  expect(s).toContain('state: real')
  expect(s).toContain('status: decided')
  expect(s).toContain('who: you')
  const o = show('use-postgres').stdout
  expect(o).toContain('state: real')
  expect(o).toContain('kind: option')
  expect(o).toContain('Needs a server')
  const b = show('benchmark-notes').stdout
  expect(b).toContain('state: real')
  expect(s).toContain('supported-by: #benchmark-notes')
  expect(b).toContain('supported_by <- #use-sqlite')
  expect(b).not.toContain('(held)')
  expect(st.code).toBe(0)
  expect(who.code).toBe(0)
})

/** Starts `werk serve` in the project and returns the graph JSON. */
async function graphOf(): Promise<{ nodes: { id: string; proposed: boolean }[] }> {
  const child = spawn(process.execPath, [MAIN, 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = ''
      const t = setTimeout(() => reject(new Error('no address')), 20_000)
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) {
          clearTimeout(t)
          resolve(m[0])
        }
      })
    })
    return (await (await fetch(url + 'api/graph')).json()) as { nodes: { id: string; proposed: boolean }[] }
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => child.once('exit', r))
  }
}

test('63.4 discarding a ghost parent discards its whole ghost branch', async () => {
  p = makeProject()
  realCard('platform', 'Platform')
  ok(['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
  ok(['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
  ok(['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
  ok(['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
  ok(['discard', 'auth'])
  for (const id of ['auth', 'magic-links', 'passwords']) {
    const r = show(id)
    expect(r.code).not.toBe(0)
  }
  const graph = await graphOf()
  const ids = graph.nodes.map((n) => n.id)
  for (const id of ['auth', 'magic-links', 'passwords']) expect(ids).not.toContain(id)
  const pl = show('platform').stdout
  expect(pl).toContain('state: real')
  expect(pl).not.toContain('#auth')
  expect(pl).not.toContain('held')
}, 40_000)

test('63.5 a ghost changes no count of a real card until it is accepted', () => {
  p = makeProject()
  realCard('storage', 'Storage', ['--status', 'decided'])
  ok(['add', 'child', '--title', 'Use a log file', '--parent', 'storage'])
  ok(['accept', 'child', '--actor', 'you'])
  ok(['status', 'child', 'decided', '--unchallenged'])
  ok(['edit', 'child', '--who', 'you'])
  const rollupOf = () => show('storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
  const before = rollupOf()
  expect(before).toBeDefined()
  expect(show('storage').stdout.toLowerCase()).not.toContain('stale')

  ok(['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--status', 'decided'])
  ok(['add', 'use-pg', '--kind', 'option', '--title', 'Use Postgres'])
  ok(['link', 'use-pg', 'use-sqlite', '--type', 'alternative_to'])
  expect(rollupOf()).toBe(before)
  expect(show('storage').stdout.toLowerCase()).not.toContain('stale')

  ok(['accept', 'use-sqlite', '--actor', 'you'])
  const after = rollupOf()!
  const cards = (l: string) => Number(/rollup: (\d+) cards/.exec(l)![1])
  expect(cards(after)).toBe(cards(before!) + 1)
})

// ---------- 67 ----------

const SESSION = 'abcdef-session-one'
function transcript(lines: object[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${SESSION}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return path
}
const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const summary = { type: 'summary', summary: 's' }

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  p = makeProject()
  const sentence = 'Every quote in the imported map was written from memory'
  transcript([summary, assistant('Hello.'), user(sentence), assistant('I see.')])
  realCard('werk-excerpt', 'Excerpts are quoted, not remembered')
  const before = logLines().length
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  expect(logLines().length).toBe(before + 1)
  const ex = events().at(-1).payload.id as string
  const s = show(ex).stdout
  expect(s).toContain('ghost')
  const start = sentence.indexOf('written from memory')
  expect(s).toContain(SESSION)
  expect(s).toContain('message 2')
  expect(s).toContain(`${start}-${start + 'written from memory'.length}`)
  expect(s).toContain('user')
  expect(show('werk-excerpt').stdout).toContain(`supported-by: #${ex}`)
})

test('67.2 the excerpt lets the person find the quote again in the transcript', () => {
  p = makeProject()
  const path = transcript([summary, user('Where?'), assistant('Keep the map in an append-only log, one line per change.')])
  realCard('werk-excerpt', 'Excerpts')
  ok(['quote', 'werk-excerpt', SESSION, '--text', 'append-only log, one line'])
  const s = show('werk-excerpt:ex0').stdout
  const m = /session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(s)!
  expect(m).not.toBeNull()
  expect(m[1]).toBe(SESSION)
  const line = JSON.parse(readFileSync(path, 'utf8').split('\n')[Number(m[2])]!)
  const content = line.message.content
  const text = typeof content === 'string' ? content : content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
  expect(text.slice(Number(m[3]), Number(m[4]))).toBe('append-only log, one line')
  expect(line.message.role).toBe('assistant')
  expect(m[5]).toBe('assistant')
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  p = makeProject()
  transcript([summary, user('Promise me that the tool never guesses.')])
  realCard('card', 'A card')
  const before = logLines().length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr).toContain('no exact match')
  expect(logLines().length).toBe(before)
  expect(show('card:ex0').code).not.toBe(0)
  expect(show('card').stdout).not.toContain('supported-by')
})

test('67.4 a quote in two messages fails and names both', () => {
  p = makeProject()
  transcript([
    summary,
    user('a'),
    assistant('b'),
    user('The reader fails instead of guessing here.'),
    assistant('c'),
    user('d'),
    assistant('e'),
    assistant('Again it fails instead of guessing.'),
  ])
  realCard('card', 'A card')
  const before = logLines().length
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const msg = r.stderr.replace(SESSION, '')
  expect(msg).toMatch(/\b3\b/)
  expect(msg).toMatch(/\b7\b/)
  expect(logLines().length).toBe(before)
  expect(show('card:ex0').code).not.toBe(0)
})

test('67.5 a ghost excerpt is accepted the same way as every other ghost', () => {
  p = makeProject()
  transcript([summary, user('Quote this exact sentence.')])
  realCard('card', 'A card')
  ok(['quote', 'card', SESSION, '--text', 'exact sentence'])
  ok(['accept', 'card:ex0', '--actor', 'you'])
  const s = show('card:ex0').stdout
  expect(s).toContain('state: real')
  expect(s).not.toContain('ghost')
  expect(show('card').stdout).toContain('supported-by: #card:ex0')
})

// ---------- 68 ----------

/** Splits inbox output into groups keyed by card id. */
function inboxGroups(out: string): Map<string, string> {
  const groups = new Map<string, string>()
  for (const block of out.split(/\n\s*\n/)) {
    const m = /^#(\S+)/.exec(block.trim())
    if (m) groups.set(m[1]!, block)
  }
  return groups
}

test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  realCard('werk-chat', 'The composer sends a live agent turn', ['--status', 'decided'])
  const before = logLines().length
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const evs = events()
  expect(evs.length).toBe(before + 1)
  expect(evs.at(-1).type).toBe('note.said')
  expect(evs.at(-1).payload.id).toBe('werk-chat')
  expect(show('werk-chat').stdout).toContain('The reply streams over SSE')
})

test('68.2 an agent reads a whole card thread in order from the inbox', () => {
  p = makeProject()
  realCard('werk-chat', 'Chat')
  for (const t of ['first', 'second', 'third']) ok(['say', 'werk-chat', '--text', t])
  const g = inboxGroups(ok(['inbox']).stdout).get('werk-chat')!
  expect(g).toBeDefined()
  const i = ['first', 'second', 'third'].map((t) => g.indexOf(t))
  expect(i.every((x) => x >= 0)).toBe(true)
  expect(i[0]! < i[1]! && i[1]! < i[2]!).toBe(true)
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  realCard('werk-chat', 'Chat')
  realCard('visual', 'Visual')
  ok(['say', 'werk-chat', '--text', 'chat one'])
  ok(['say', 'visual', '--text', 'visual one'])
  ok(['say', 'werk-chat', '--text', 'chat two'])
  const groups = inboxGroups(ok(['inbox']).stdout)
  const chat = groups.get('werk-chat')!
  const vis = groups.get('visual')!
  expect(chat.indexOf('chat one')).toBeGreaterThanOrEqual(0)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one')
  expect(vis).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  realCard('visual', 'Visual')
  ok(['add', 'werk-pane', '--title', 'The pane'])
  ok(['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  const g = inboxGroups(ok(['inbox']).stdout).get('werk-pane')
  expect(g).toBeDefined()
  expect(g).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  realCard('werk-chat', 'Chat')
  const size = readFileSync(logFile()).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('no-such-card')
  expect(readFileSync(logFile()).length).toBe(size)
  expect(p.werk(['inbox']).stdout).not.toContain('lost note')
})

// ---------- 80 ----------

type T = { n: number; title: string; cites: string; blocked?: string; stories: string; touches?: string | null; what?: string | null }
function ticketText(t: T): string {
  const header = [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'decision log'}`]),
  ]
  return [
    ...header,
    '',
    ...(t.what === null ? [] : ['## What to build', '', t.what ?? 'A person sees the change in the map.', '']),
    '## Acceptance criteria',
    '',
    '- [ ] The change shows in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}
const name = (n: number) => `0${n}-ticket.md`
function writeTickets(ts: T[]) {
  const dir = join(p.dir, 'tickets')
  mkdirSync(dir, { recursive: true })
  for (const t of ts) writeFileSync(join(dir, name(t.n)), ticketText(t))
}
function spec(n: number) {
  const stories = Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`)
  writeFileSync(join(p.dir, 'spec.md'), ['# Spec', '', '## User stories', '', ...stories, '', '## Implementation decisions', ''].join('\n'))
}
function ticketProject(decided: string[], extraOpen: string[] = []) {
  p = makeProject()
  realCard('map', 'The map', ['--status', 'open'])
  for (const id of decided) realCard(id, `Card ${id}`, ['--parent', 'map', '--status', 'decided'])
  for (const id of extraOpen) realCard(id, `Card ${id}`, ['--parent', 'map', '--status', 'open'])
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  ticketProject(['map-reopen', 'map-stale'])
  spec(3)
  writeTickets([
    { n: 1, title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    { n: 2, title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  ])
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
})

test('80.2 own-check failures are named per ticket', () => {
  ticketProject(['map-reopen', 'map-stale'])
  spec(3)
  writeTickets([
    { n: 1, title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' },
    { n: 2, title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '2' },
    { n: 3, title: 'Name the cause', cites: 'map-stale', blocked: '2', stories: '3' },
  ])
  expect(check().code).toBe(0)
  const dir = join(p.dir, 'tickets')
  const edit = (n: number, f: (s: string) => string) => writeFileSync(join(dir, name(n)), f(readFileSync(join(dir, name(n)), 'utf8')))
  edit(2, (s) => s.replace(/^touches:.*\n/m, ''))
  edit(3, (s) => s.replace('A person sees the change in the map.', 'A person sees the change in the map.\nedit src/loop.ts'))
  edit(1, (s) => s.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const t3Line = readFileSync(join(dir, name(3)), 'utf8').split('\n').findIndex((l) => l.includes('src/loop.ts')) + 1
  const r = check()
  const out = r.stdout
  expect(out).toMatch(new RegExp(`^${name(2)}: shape: touches`, 'm'))
  expect(out).toMatch(new RegExp(`^${name(3)}: no-file-paths: .*line ${t3Line}\\b.*src/loop\\.ts`, 'm'))
  expect(out).toMatch(new RegExp(`^${name(1)}: touches: `, 'm'))
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  ticketProject(['map-reopen', 'map-stale'])
  spec(3)
  writeTickets([
    { n: 1, title: 'Reopen a card', cites: 'map-reopen', stories: '1' },
    { n: 2, title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '3' },
    { n: 3, title: 'More reopen', cites: 'map-reopen', blocked: '1', stories: '2' },
    { n: 4, title: 'After stale', cites: 'map-reopen', blocked: '2', stories: '2' },
  ])
  expect(check().code).toBe(0)
  const f = join(p.dir, 'tickets', name(2))
  writeFileSync(f, readFileSync(f, 'utf8').replace('## What to build\n', ''))
  const r = check()
  const out = r.stdout
  expect(out).toMatch(new RegExp(`^${name(2)}: shape: What to build`, 'm'))
  expect(out).toMatch(/cards-cited: .*map-stale/)
  expect(out).toMatch(/stories: .*story 3\b/)
  expect(out).toMatch(new RegExp(`^${name(4)}: blocked_by: .*\\b2\\b`, 'm'))
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  ticketProject(['map-reopen', 'map-stale', 'map-third'])
  spec(4)
  writeTickets([
    { n: 1, title: 'One', cites: 'map-stale', stories: '1, 9' },
    { n: 2, title: 'Two', cites: 'map-third', blocked: '3', stories: '2' },
    { n: 3, title: 'Three', cites: 'map-third', blocked: '2', stories: '3' },
    { n: 4, title: 'Four', cites: 'map-stale', blocked: '1', stories: '3' },
    { n: 5, title: 'Five', cites: 'map-stale', blocked: '8', stories: '1' },
  ])
  const r = check()
  const out = r.stdout
  expect(out).toMatch(/cards-cited: .*map-reopen/)
  expect(out).toMatch(/stories: .*no ticket delivers story 4/)
  expect(out).toMatch(/stories: .*story 9/)
  expect(out).toMatch(new RegExp(`^${name(2)}: blocked_by: .*cycle`, 'm'))
  expect(out).toMatch(new RegExp(`^${name(3)}: blocked_by: .*cycle`, 'm'))
  expect(out).toMatch(new RegExp(`^${name(5)}: blocked_by: .*\\b8\\b`, 'm'))
  expect(out).not.toMatch(new RegExp(`^${name(1)}: blocked_by`, 'm'))
  expect(out).not.toMatch(new RegExp(`^${name(4)}: blocked_by`, 'm'))
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket and the next check passes', () => {
  ticketProject(['map-reopen', 'map-stale'])
  spec(3)
  writeTickets([
    { n: 1, title: 'Reopen a card', cites: 'map-reopen', stories: '1' },
    { n: 2, title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '2' },
  ])
  const first = check()
  expect(first.code).not.toBe(0)
  expect(failureLines(first.stdout)).toHaveLength(1)
  expect(first.stdout).toMatch(/story 3/)
  const f = join(p.dir, 'tickets', name(2))
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

