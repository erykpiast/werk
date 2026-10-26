/** Held-out tests for the map verbs: 62.x, 63.x, 67.x, 68.x. */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

function project(): Project {
  const p = makeProject()
  cleanups.push(p.cleanup)
  return p
}

const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter((l) => l !== '') : [])
const events = (p: Project) => logLines(p).map((l) => JSON.parse(l))

function ok(p: Project, args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}

/** Asserts that `after` is `before` plus exactly one line at the end. */
function expectOneMore(before: string[], after: string[]) {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

/** A real card: proposed and accepted with the person's claim. */
function realCard(p: Project, id: string, title: string, extra: string[] = []) {
  ok(p, ['add', id, '--title', title, ...extra])
  ok(p, ['accept', id, '--actor', 'you'])
}

const show = (p: Project, id: string) => p.werk(['show', id])

describe('62 propose and accept', () => {
  test('62.1 an agent proposes a card and a person accepts it', () => {
    const p = project()
    realCard(p, 'base', 'Base')
    ok(p, ['say', 'base', '--text', 'some event'])
    const before = logLines(p)
    expect(before.length).toBeGreaterThan(0)

    const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'The map is a log.', '--why', 'It keeps history.'])
    expect(add.code).toBe(0)
    expect(add.stdout).toContain('proposed')
    const afterAdd = logLines(p)
    expectOneMore(before, afterAdd)

    const s1 = show(p, 'use-log')
    expect(s1.code).toBe(0)
    expect(s1.stdout).toContain('Use a log')
    expect(s1.stdout).toContain('The map is a log.')
    expect(s1.stdout).toContain('It keeps history.')
    expect(s1.stdout).toMatch(/ghost/)

    const acc = p.werk(['accept', 'use-log', '--actor', 'you'])
    expect(acc.code).toBe(0)
    expectOneMore(afterAdd, logLines(p))

    const s2 = show(p, 'use-log')
    expect(s2.stdout).toContain('Use a log')
    expect(s2.stdout).toContain('The map is a log.')
    expect(s2.stdout).toContain('It keeps history.')
    expect(s2.stdout).toContain('state: real')
    expect(s2.stdout).not.toMatch(/ghost/)
  })

  test('62.2 an accept without the claim refuses', () => {
    const p = project()
    ok(p, ['add', 'c', '--title', 'C'])
    const before = logLines(p)
    const r = p.werk(['accept', 'c'])
    expect(r.code).not.toBe(0)
    expect(logLines(p)).toEqual(before)
    expect(show(p, 'c').stdout).toMatch(/ghost/)
    ok(p, ['accept', 'c', '--actor', 'you'])
    expect(show(p, 'c').stdout).toContain('state: real')
  })

  test('62.3 the words of a ghost are frozen', () => {
    const p = project()
    ok(p, ['add', 'c', '--title', 'Use a log'])
    let before = logLines(p)
    expect(p.werk(['edit', 'c', '--body', 'new body']).code).not.toBe(0)
    expect(logLines(p)).toEqual(before)
    expect(p.werk(['retitle', 'c', '--title', 'Use an append-only log']).code).not.toBe(0)
    expect(logLines(p)).toEqual(before)
    expect(p.werk(['add', 'c', '--title', 'Other title']).code).not.toBe(0)
    expect(logLines(p)).toEqual(before)
    const s = show(p, 'c').stdout
    expect(s).toContain('Use a log')
    expect(s).toMatch(/ghost/)
  })

  test('62.4 a retitle on a real card keeps the old title in the log', () => {
    const p = project()
    realCard(p, 'c', 'Use a log')
    const before = logLines(p)
    const r = p.werk(['retitle', 'c', '--title', 'Use an append-only log'])
    expect(r.code).toBe(0)
    const after = logLines(p)
    expectOneMore(before, after)
    const s = show(p, 'c').stdout
    expect(s).toContain('Use an append-only log')
    expect(s).not.toContain('Use a log')
    expect(after.slice(0, -1).some((l) => l.includes('"Use a log"'))).toBe(true)
    ok(p, ['edit', 'c', '--body', 'A fresh body'])
    const s2 = show(p, 'c').stdout
    expect(s2).toContain('A fresh body')
    expect(s2).toContain('Use an append-only log')
  })

  test('62.5 an option, a source and an excerpt also enter as ghosts', () => {
    const p = project()
    realCard(p, 'card', 'Card')
    const adds: [string, string[]][] = [
      ['opt', ['--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Too heavy', '--parent', 'card']],
      ['src', ['--kind', 'source', '--title', 'Benchmark notes']],
      ['exc', ['--kind', 'excerpt', '--title', 'A quoted line']],
    ]
    for (const [id, flags] of adds) {
      const before = logLines(p)
      const r = p.werk(['add', id, ...flags])
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('proposed')
      expectOneMore(before, logLines(p))
    }
    const o = show(p, 'opt').stdout
    expect(o).toContain('Use Postgres')
    expect(o).toContain('Too heavy')
    expect(o).toMatch(/ghost/)
    expect(show(p, 'src').stdout).toContain('Benchmark notes')
    expect(show(p, 'src').stdout).toMatch(/ghost/)
    expect(show(p, 'exc').stdout).toContain('A quoted line')
    expect(show(p, 'exc').stdout).toMatch(/ghost/)

    ok(p, ['accept', 'opt', '--actor', 'you'])
    const o2 = show(p, 'opt').stdout
    expect(o2).toContain('state: real')
    expect(o2).toContain('why-not: Too heavy')
    expect(show(p, 'src').stdout).toMatch(/ghost/)
    expect(show(p, 'exc').stdout).toMatch(/ghost/)
  })
})

describe('63 ghost branches', () => {
  test('63.1 a link to a ghost is held, and goes live on accept', () => {
    const p = project()
    realCard(p, 'storage', 'Storage')
    ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'])
    ok(p, ['link', 'use-sqlite', 'storage', '--type', 'depends_on'])
    expect(show(p, 'use-sqlite').stdout).toContain('link: depends_on -> #storage (held)')
    const st = show(p, 'storage').stdout
    expect(st).not.toMatch(/^link: depends_on <- #use-sqlite$/m)
    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
    expect(show(p, 'use-sqlite').stdout).toMatch(/^link: depends_on -> #storage$/m)
    const links = events(p).filter(
      (e) => e.type === 'edge.linked' && e.payload.from === 'use-sqlite' && e.payload.to === 'storage' && e.payload.type === 'depends_on',
    )
    expect(links.length).toBe(1)
  })

  test('63.2 accepting a ghost child accepts its ghost parent, not a dependency', () => {
    const p = project()
    realCard(p, 'platform', 'Platform')
    ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
    ok(p, ['add', 'email-service', '--title', 'Email service', '--parent', 'platform'])
    ok(p, ['link', 'magic-links', 'email-service', '--type', 'depends_on'])
    ok(p, ['accept', 'magic-links', '--actor', 'you'])
    expect(show(p, 'magic-links').stdout).toContain('state: real')
    const auth = show(p, 'auth').stdout
    expect(auth).toContain('state: real')
    expect(auth).toContain('parent: #platform')
    expect(show(p, 'email-service').stdout).toMatch(/ghost/)
    expect(show(p, 'magic-links').stdout).toContain('link: depends_on -> #email-service (held)')
  })

  test('63.3 an accept takes the own ghost options and sources', () => {
    const p = project()
    realCard(p, 'storage', 'Storage')
    const steps: string[][] = [
      ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage'],
      ['add', 'use-postgres', '--kind', 'option', '--title', 'Use Postgres', '--why-not', 'Needs a server'],
      ['link', 'use-postgres', 'use-sqlite', '--type', 'alternative_to'],
      ['add', 'benchmark-notes', '--kind', 'source', '--title', 'Benchmark notes'],
      ['link', 'use-sqlite', 'benchmark-notes', '--type', 'supported_by'],
    ]
    for (const s of steps) ok(p, s)
    const status = p.werk(['status', 'use-sqlite', 'decided'])
    const who = p.werk(['edit', 'use-sqlite', '--who', 'you'])
    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])

    const s = show(p, 'use-sqlite').stdout
    expect(s).toContain('state: real')
    expect(s).toContain('status: decided')
    expect(s).toContain('who: you')
    const o = show(p, 'use-postgres').stdout
    expect(o).toContain('state: real')
    expect(o).toContain('kind: option')
    expect(o).toContain('why-not: Needs a server')
    const b = show(p, 'benchmark-notes').stdout
    expect(b).toContain('state: real')
    expect(b).toContain('kind: source')
    expect(b).toMatch(/^link: supported_by <- #use-sqlite$/m)
    expect(status.code).toBe(0)
    expect(who.code).toBe(0)
  })

  test('63.4 discarding a ghost parent discards its branch', () => {
    const p = project()
    realCard(p, 'platform', 'Platform')
    ok(p, ['add', 'auth', '--title', 'Auth', '--parent', 'platform'])
    ok(p, ['add', 'magic-links', '--title', 'Magic links', '--parent', 'auth'])
    ok(p, ['add', 'passwords', '--kind', 'option', '--title', 'Passwords'])
    ok(p, ['link', 'passwords', 'magic-links', '--type', 'alternative_to'])
    ok(p, ['discard', 'auth'])
    for (const id of ['auth', 'magic-links', 'passwords']) expect(show(p, id).code).not.toBe(0)
    const pl = show(p, 'platform').stdout
    expect(pl).toContain('state: real')
    expect(pl).not.toMatch(/auth|magic-links|passwords|held/)
  })

  test('63.5 a ghost changes no count until accepted', () => {
    const p = project()
    realCard(p, 'storage', 'Storage')
    realCard(p, 'child', 'Child', ['--parent', 'storage'])
    ok(p, ['edit', 'child', '--who', 'you'])
    ok(p, ['status', 'child', 'decided', '--unchallenged'])
    const rollupOf = () => show(p, 'storage').stdout.split('\n').find((l) => l.startsWith('rollup:'))
    const before = show(p, 'storage').stdout
    const r0 = rollupOf()
    expect(r0).toBeDefined()
    expect(r0).toContain('1 unchallenged')
    expect(before).not.toMatch(/stale/i)

    ok(p, ['add', 'use-sqlite', '--title', 'Use SQLite', '--parent', 'storage', '--status', 'decided'])
    ok(p, ['add', 'use-pg', '--kind', 'option', '--title', 'Use Postgres'])
    ok(p, ['link', 'use-pg', 'use-sqlite', '--type', 'alternative_to'])
    expect(rollupOf()).toBe(r0)
    expect(show(p, 'storage').stdout).not.toMatch(/stale/i)

    ok(p, ['accept', 'use-sqlite', '--actor', 'you'])
    const r1 = rollupOf()!
    expect(r0).toMatch(/rollup: 2 cards/)
    expect(r1).toMatch(/rollup: 3 cards/)
  })
})

describe('67 quote', () => {
  const SESSION = 'aaaa1111-0000-4000-8000-000000000001'
  function writeTranscript(p: Project, lines: unknown[]) {
    const file = join(dirname(p.dir), '.claude', 'projects', '-tmp-proj', `${SESSION}.jsonl`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return file
  }
  const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
  const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
  const summary = { type: 'summary', summary: 's' }

  test('67.1 a quote found once becomes a ghost excerpt on the citing card', () => {
    const p = project()
    realCard(p, 'werk-excerpt', 'Excerpts')
    const msg = 'Every quote in the imported map was written from memory'
    writeTranscript(p, [summary, assistant('Hello there'), user(msg), assistant('Ok')])
    const r = p.werk(['quote', 'werk-excerpt', SESSION, '--text', 'written from memory'])
    expect(r.code).toBe(0)
    const ex = show(p, 'werk-excerpt:ex0').stdout
    expect(ex).toMatch(/ghost/)
    const start = msg.indexOf('written from memory')
    expect(ex).toContain(`quote: session ${SESSION}, message 2, characters ${start}-${start + 'written from memory'.length}, said by user`)
    expect(show(p, 'werk-excerpt').stdout).toContain('supported-by: #werk-excerpt:ex0')
  })

  test('67.2 the excerpt lets the person find the quote again', () => {
    const p = project()
    realCard(p, 'werk-excerpt', 'Excerpts')
    const file = writeTranscript(p, [
      summary,
      user('Where?'),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'First block.' }, { type: 'text', text: 'Keep the map in an append-only log.' }] } },
    ])
    const quoted = 'an append-only log'
    ok(p, ['quote', 'werk-excerpt', SESSION, '--text', quoted])
    const ex = show(p, 'werk-excerpt:ex0').stdout
    const m = /quote: session (\S+), message (\d+), characters (\d+)-(\d+), said by (\w+)/.exec(ex)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(SESSION)
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[Number(m![2])]!)
    const text = (line.message.content as { type: string; text: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    expect(text.slice(Number(m![3]), Number(m![4]))).toBe(quoted)
    expect(line.message.role).toBe('assistant')
    expect(m![5]).toBe('assistant')
  })

  test('67.3 a quote with one changed character fails', () => {
    const p = project()
    realCard(p, 'card', 'Card')
    writeTranscript(p, [summary, user('Remember: the tool never guesses.')])
    const before = logLines(p)
    const r = p.werk(['quote', 'card', SESSION, '--text', 'the tool never gueses'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('no exact match')
    expect(logLines(p)).toEqual(before)
    expect(events(p).some((e) => e.payload?.kind === 'excerpt')).toBe(false)
  })

  test('67.4 a quote in two messages fails and names both', () => {
    const p = project()
    realCard(p, 'card', 'Card')
    const lines: unknown[] = [summary, user('a'), assistant('b'), user('It fails instead of guessing.'), assistant('c'), user('d'), assistant('e'), assistant('It always fails instead of guessing!')]
    writeTranscript(p, lines)
    const before = logLines(p)
    const r = p.werk(['quote', 'card', SESSION, '--text', 'fails instead of guessing'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/\b3\b/)
    expect(r.stderr).toMatch(/\b7\b/)
    expect(r.stderr).toContain('3, 7')
    expect(logLines(p)).toEqual(before)
    expect(events(p).some((e) => e.payload?.kind === 'excerpt')).toBe(false)
  })

  test('67.5 a ghost excerpt is accepted like every other ghost', () => {
    const p = project()
    realCard(p, 'card', 'Card')
    writeTranscript(p, [summary, user('The quoted words are here.')])
    ok(p, ['quote', 'card', SESSION, '--text', 'quoted words'])
    ok(p, ['accept', 'card:ex0', '--actor', 'you'])
    const ex = show(p, 'card:ex0').stdout
    expect(ex).toContain('state: real')
    expect(ex).not.toMatch(/ghost/)
    expect(show(p, 'card').stdout).toContain('supported-by: #card:ex0')
  })
})

describe('68 notes', () => {
  /** The lines of one inbox group, from its head to the next blank line. */
  function group(out: string, id: string): string[] | undefined {
    const lines = out.split('\n')
    const at = lines.findIndex((l) => l.startsWith(`#${id} `))
    if (at === -1) return undefined
    const end = lines.findIndex((l, i) => i > at && l.trim() === '')
    return lines.slice(at, end === -1 ? undefined : end)
  }

  test('68.1 an agent writes a note on a card and sees it', () => {
    const p = project()
    realCard(p, 'werk-chat', 'The composer sends a live agent turn')
    ok(p, ['status', 'werk-chat', 'decided'])
    const before = events(p).length
    const r = p.werk(['say', 'werk-chat', '--text', 'The reply streams over SSE'])
    expect(r.code).toBe(0)
    const after = events(p)
    expect(after.length).toBe(before + 1)
    expect(after.at(-1).type).toBe('note.said')
    expect(after.at(-1).payload.id).toBe('werk-chat')
    expect(show(p, 'werk-chat').stdout).toContain('The reply streams over SSE')
  })

  test('68.2 the inbox shows a thread in order', () => {
    const p = project()
    realCard(p, 'werk-chat', 'Chat')
    for (const t of ['first', 'second', 'third']) ok(p, ['say', 'werk-chat', '--text', t])
    const g = group(ok(p, ['inbox']).stdout, 'werk-chat')
    expect(g).toBeDefined()
    const idx = ['first', 'second', 'third'].map((t) => g!.findIndex((l) => l.endsWith(`: ${t}`)))
    expect(idx.every((i) => i > 0)).toBe(true)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })

  test('68.3 the inbox groups notes by card', () => {
    const p = project()
    realCard(p, 'werk-chat', 'Chat')
    realCard(p, 'visual', 'Visual')
    ok(p, ['say', 'werk-chat', '--text', 'chat one'])
    ok(p, ['say', 'visual', '--text', 'visual one'])
    ok(p, ['say', 'werk-chat', '--text', 'chat two'])
    const out = ok(p, ['inbox']).stdout
    const chat = group(out, 'werk-chat')!.join('\n')
    const vis = group(out, 'visual')!.join('\n')
    expect(chat.indexOf('chat one')).toBeGreaterThan(-1)
    expect(chat.indexOf('chat two')).toBeGreaterThan(chat.indexOf('chat one'))
    expect(vis).toContain('visual one')
    expect(vis).not.toContain('chat one')
    expect(vis).not.toContain('chat two')
  })

  test('68.4 an agent writes a note on a ghost card', () => {
    const p = project()
    realCard(p, 'visual', 'Visual')
    ok(p, ['add', 'werk-pane', '--title', 'The pane'])
    ok(p, ['link', 'visual', 'werk-pane', '--type', 'depends_on'])
    expect(show(p, 'werk-pane').stdout).toMatch(/ghost/)
    const r = p.werk(['say', 'werk-pane', '--text', 'Describe the pane here'])
    expect(r.code).toBe(0)
    const g = group(ok(p, ['inbox']).stdout, 'werk-pane')
    expect(g).toBeDefined()
    expect(g!.join('\n')).toContain('Describe the pane here')
  })

  test('68.5 a note on an unknown card fails', () => {
    const p = project()
    realCard(p, 'werk-chat', 'Chat')
    const size = readFileSync(logFile(p)).length
    const r = p.werk(['say', 'no-such-card', '--text', 'lost note'])
    expect(r.code).not.toBe(0)
    expect(r.stdout + r.stderr).toContain('no-such-card')
    expect(r.stdout + r.stderr).toMatch(/no node|unknown/)
    expect(readFileSync(logFile(p)).length).toBe(size)
    expect(p.werk(['inbox']).stdout).not.toContain('lost note')
  })
})
