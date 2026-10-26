/** Held-out steps 67.x (quote), 68.x (say / inbox), 80.x (ticket-check). */
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

const logLines = () => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}
const ok = (args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}

// ---------- 67.x quote ----------
const SESSION = 'aaaa1111-0000-4000-8000-000000000067'
const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const asstLine = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })

function withTranscript(lines: string[]) {
  p = makeProject()
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')
  return lines
}

test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
  const USER = 'Every quote in the imported map was written from memory'
  withTranscript([
    JSON.stringify({ type: 'summary', summary: 's' }),
    asstLine('Hello, what do you want?'),
    userLine(USER),
    asstLine('I see.'),
  ])
  ok(['add', 'werk-excerpt', '--title', 'Excerpts point at transcripts'])
  const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
  expect(r.code).toBe(0)
  const ex = JSON.parse(logLines().at(-1)!).payload.id as string
  const show = ok(['show', ex]).stdout
  expect(show).toContain('state: ghost')
  const start = USER.indexOf('written from memory')
  expect(show).toContain(
    `quote: session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`,
  )
  expect(ok(['show', 'werk-excerpt']).stdout).toMatch(new RegExp(`supported-by: .*#${ex.replace(/[:]/g, '\\:')}`))
})

test('67.2 the excerpt lets the person find the quote again', () => {
  const lines = withTranscript([
    userLine('How does werk quote?'),
    asstLine('First line.'),
    asstLine('The tool reads the transcript and never invents a quote.'),
  ])
  ok(['add', 'werk-excerpt', '--title', 'Excerpts'])
  ok(['quote', 'werk-excerpt', SESSION, '--text', 'never invents a quote'])
  const ex = JSON.parse(logLines().at(-1)!).payload.id as string
  const show = ok(['show', ex]).stdout
  const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(show)
  expect(m).not.toBeNull()
  const [, session, idx, s, e, speaker] = m!
  expect(session).toBe(SESSION)
  const file = readFileSync(join(p.env.HOME!, '.claude', 'projects', '-some-project', `${session}.jsonl`), 'utf8').split('\n')
  const msg = JSON.parse(file[Number(idx)]!)
  const text = (msg.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  expect(text.slice(Number(s), Number(e))).toBe('never invents a quote')
  expect(msg.message.role).toBe('assistant')
  expect(speaker).toBe('assistant')
  void lines
})

test('67.3 a quote with one changed character fails and changes nothing', () => {
  withTranscript([userLine('Remember: the tool never guesses.')])
  ok(['add', 'card', '--title', 'A card'])
  const before = logLines()
  const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no exact match')
  expect(logLines()).toEqual(before)
  expect(ok(['show', 'card']).stdout).not.toContain('supported-by')
  expect(p.werk(['show', 'card:ex0']).code).not.toBe(0)
})

test('67.4 a quote in two messages fails and names both', () => {
  withTranscript([
    userLine('m0'),
    asstLine('m1'),
    userLine('m2'),
    asstLine('It fails instead of guessing, always.'),
    userLine('m4'),
    asstLine('m5'),
    userLine('m6'),
    userLine('Yes, it fails instead of guessing.'),
  ])
  ok(['add', 'card', '--title', 'A card'])
  const before = logLines()
  const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
  expect(r.code).not.toBe(0)
  const out = r.stderr + r.stdout
  expect(out).toMatch(/\b3\b/)
  expect(out).toMatch(/\b7\b/)
  expect(out).toContain('3, 7')
  expect(logLines()).toEqual(before)
  expect(ok(['show', 'card']).stdout).not.toContain('supported-by')
})

test('67.5 a ghost excerpt is accepted like any ghost', () => {
  withTranscript([userLine('Keep the map in an append-only log.')])
  ok(['add', 'card', '--title', 'A card'])
  ok(['accept', 'card', '--actor', 'you'])
  ok(['quote', 'card', SESSION, '--text', 'append-only log'])
  const ex = JSON.parse(logLines().at(-1)!).payload.id as string
  expect(ok(['show', ex]).stdout).toContain('state: ghost')
  const r = p.werk(['accept', ex, '--actor', 'you'])
  expect(r.code).toBe(0)
  const show = ok(['show', ex]).stdout
  expect(show).toContain('state: real')
  expect(show).not.toContain('ghost')
  expect(ok(['show', 'card']).stdout).toContain(`supported-by: #${ex}`)
})

// ---------- 68.x say / inbox ----------
test('68.1 an agent writes a note on a card and sees it on the card', () => {
  p = makeProject()
  ok(['add', 'werk-chat', '--title', 'The composer sends a live agent turn'])
  ok(['accept', 'werk-chat', '--actor', 'you'])
  // The step names a decided card; status is set through the log so the contract check does not apply here.
  const lines = logLines()
  const seq = lines.length + 1
  writeFileSync(
    join(p.dir, '.werk', 'log.jsonl'),
    lines.join('\n') + '\n' + JSON.stringify({ type: 'node.status_set', payload: { id: 'werk-chat', status: 'decided' }, seq, at: new Date().toISOString(), actor: 'you' }) + '\n',
  )
  const before = logLines()
  const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
  expect(r.code).toBe(0)
  const after = logLines()
  expect(after.length).toBe(before.length + 1)
  const ev = JSON.parse(after.at(-1)!)
  expect(ev.type).toBe('note.said')
  expect(ev.payload.id).toBe('werk-chat')
  expect(ok(['show', 'werk-chat']).stdout).toContain('The reply streams over SSE')
})

/** The lines of the inbox group headed by `#id`. */
const group = (inbox: string, id: string) => {
  const groups = inbox.split('\n\n')
  return groups.find((g) => g.split('\n')[0]!.startsWith(`#${id} `)) ?? ''
}

test('68.2 an agent reads a whole thread in order from the inbox', () => {
  p = makeProject()
  ok(['add', 'werk-chat', '--title', 'Chat'])
  for (const t of ['first', 'second', 'third']) ok(['say', 'werk-chat', '--text', t])
  const g = group(ok(['inbox']).stdout, 'werk-chat')
  expect(g).not.toBe('')
  const a = g.indexOf(': first'), b = g.indexOf(': second'), c = g.indexOf(': third')
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(c).toBeGreaterThan(b)
})

test('68.3 the inbox groups notes by card', () => {
  p = makeProject()
  ok(['add', 'werk-chat', '--title', 'Chat'])
  ok(['add', 'visual', '--title', 'Visual'])
  ok(['say', 'werk-chat', '--text', 'chat one'])
  ok(['say', 'visual', '--text', 'visual one'])
  ok(['say', 'werk-chat', '--text', 'chat two'])
  const inbox = ok(['inbox']).stdout
  const chat = group(inbox, 'werk-chat')
  const vis = group(inbox, 'visual')
  expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
  expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
  expect(vis).toContain('visual one')
  expect(vis).not.toContain('chat one')
  expect(vis).not.toContain('chat two')
})

test('68.4 an agent writes a note on a ghost card', () => {
  p = makeProject()
  ok(['add', 'visual', '--title', 'Visual'])
  ok(['accept', 'visual', '--actor', 'you'])
  ok(['add', 'werk-pane', '--title', 'The pane'])
  ok(['link', 'visual', 'werk-pane', '--type', 'depends_on'])
  expect(ok(['show', 'werk-pane']).stdout).toContain('state: ghost')
  const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
  expect(r.code).toBe(0)
  expect(group(ok(['inbox']).stdout, 'werk-pane')).toContain('Describe the pane here')
})

test('68.5 a note on an unknown card fails and changes nothing', () => {
  p = makeProject()
  ok(['add', 'werk-chat', '--title', 'Chat'])
  const size = readFileSync(join(p.dir, '.werk', 'log.jsonl')).length
  const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
  expect(r.code).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('no-such-card')
  expect(r.stderr + r.stdout).toMatch(/no node|unknown/)
  expect(readFileSync(join(p.dir, '.werk', 'log.jsonl')).length).toBe(size)
  expect(ok(['inbox']).stdout).not.toContain('lost note')
})

// ---------- 80.x ticket-check ----------
function mapProject(decidedExtra: string[] = []) {
  p = makeProject()
  const ids = ['map-reopen', 'map-stale', ...decidedExtra]
  const log = logOf(
    proposed('map', { status: 'open' }),
    ...ids.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    ...ids.map((id) => accepted(id)),
    accepted('map'),
  )
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

type T = { title: string; cites: string; blocked?: string; stories: string; touches: string; what?: string }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.what ?? 'A person does a thing, and the map shows the result.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The map shows the result.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const spec = (n: number) =>
  ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`), ''].join('\n')

const writeTickets = (files: Record<string, string>, stories: number) => {
  rmSync(join(p.dir, 'tickets'), { recursive: true, force: true })
  mkdirSync(join(p.dir, 'tickets'), { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, 'tickets', name), text)
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const edit = (name: string, f: (s: string) => string) => {
  const path = join(p.dir, 'tickets', name)
  writeFileSync(path, f(readFileSync(path, 'utf8')))
}

test('80.1 a folder of valid tickets passes', () => {
  mapProject()
  writeTickets(
    {
      '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
      '02-stale.md': ticket({ title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }),
    },
    3,
  )
  const r = check()
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.stdout.trim().split('\n')).toHaveLength(1)
  expect(r.code).toBe(0)
})

const validThree = () => ({
  '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' }),
  '02-stale.md': ticket({ title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' }),
  '03-name.md': ticket({ title: 'Name the cause', cites: 'map-reopen', blocked: '2', stories: '3', touches: 'stale marks' }),
})

test('80.2 own-check failures are named per ticket', () => {
  mapProject()
  writeTickets(validThree(), 3)
  expect(check().code).toBe(0)
  edit('02-stale.md', (s) => s.replace(/^touches:.*\n/m, ''))
  edit('03-name.md', (s) => s.replace('A person does a thing, and the map shows the result.', 'A person does a thing, and the map shows the result.\nedit src/loop.ts'))
  edit('01-reopen.md', (s) => s.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check()
  const out = r.stdout
  expect(out).toMatch(/^02-stale\.md: shape: touches: /m)
  const pathLine = /^03-name\.md: no-file-paths: .*line (\d+).*"src\/loop\.ts"/m.exec(out)
  expect(pathLine).not.toBeNull()
  const fileLines = readFileSync(join(p.dir, 'tickets', '03-name.md'), 'utf8').split('\n')
  expect(fileLines[Number(pathLine![1]) - 1]).toContain('src/loop.ts')
  expect(out).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  mapProject()
  writeTickets(
    {
      '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' }),
      '02-stale.md': ticket({ title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2, 3', touches: 'decision log' }),
      '04-after.md': ticket({ title: 'Follow up', cites: 'map-reopen', blocked: '2', stories: '2', touches: 'stale marks' }),
    },
    3,
  )
  expect(check().code).toBe(0)
  edit('02-stale.md', (s) => s.replace('## What to build\n', ''))
  const r = check()
  const out = r.stdout
  expect(out).toMatch(/^02-stale\.md: shape: .*What to build/m)
  expect(out).toContain('no ticket cites the decided card #map-stale')
  expect(out).toContain('no ticket delivers story 3')
  expect(out).toMatch(/^04-after\.md: blocked_by: .*2/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  mapProject()
  writeTickets(
    {
      '01-a.md': ticket({ title: 'Ticket one', cites: 'map-stale', stories: '1, 9', touches: 'map view' }),
      '02-b.md': ticket({ title: 'Ticket two', cites: 'map-stale', blocked: '3', stories: '2', touches: 'map view' }),
      '03-c.md': ticket({ title: 'Ticket three', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' }),
      '04-d.md': ticket({ title: 'Ticket four', cites: 'map-stale', blocked: '1', stories: '1', touches: 'map view' }),
      '05-e.md': ticket({ title: 'Ticket five', cites: 'map-stale', blocked: '8', stories: '2', touches: 'map view' }),
    },
    4,
  )
  const r = check()
  const out = r.stdout
  expect(out).toContain('no ticket cites the decided card #map-reopen')
  expect(out).toContain('no ticket delivers story 4')
  expect(out).toMatch(/story 9 .*spec has no story 9/)
  expect(out).toMatch(/^02-b\.md: blocked_by: .*cycle/m)
  expect(out).toMatch(/^03-c\.md: blocked_by: .*cycle/m)
  expect(out).toMatch(/^05-e\.md: blocked_by: .*8/m)
  expect(out).not.toMatch(/^01-a\.md: blocked_by/m)
  expect(out).not.toMatch(/^04-d\.md: blocked_by/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket and the next check passes', () => {
  mapProject()
  writeTickets(
    {
      '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' }),
      '02-stale.md': ticket({ title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' }),
    },
    3,
  )
  const first = check()
  expect(first.code).not.toBe(0)
  const failures = first.stdout.trim().split('\n').slice(0, -1)
  expect(failures).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  edit('02-stale.md', (s) => s.replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check()
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})
