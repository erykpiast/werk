import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLI, testEnv } from '../test/env.ts'
import { makeProject, liveHello, openLive, startServe, type LiveChannel, type RunningServer, type TempProject } from '../test/harness.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
let live: LiveChannel | undefined
afterEach(async () => {
  live?.close()
  live = undefined
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})

test('help prints the usage and exits 0', () => {
  project = makeProject()
  const result = project.run(['help'])
  expect(result.code).toBe(0)
  expect(result.stdout).toContain('usage: werk <command>')
})

test('an unknown command exits 1 and names the command on stderr', () => {
  project = makeProject()
  const result = project.run(['frobnicate'])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('werk: unknown command: frobnicate')
})

test('the harness makes a git repository with one commit', () => {
  project = makeProject({ files: { 'notes.txt': 'hello\n' } })
  const log = project.git(['log', '--oneline'])
  expect(log.code).toBe(0)
  expect(log.stdout.trim().split('\n')).toHaveLength(1)
  expect(project.git(['ls-files']).stdout).toContain('notes.txt')
})

test('a write command appends to the project log, and show prints the folded page', () => {
  project = makeProject()
  const added = project.run(['add', 'a', '--title', 'Use a log'])
  expect(added).toEqual({ code: 0, stdout: '1 added #a\n', stderr: '' })
  expect(project.run(['add', 'b', '--title', 'Cards fold from it', '--parent', 'a']).stdout).toBe('2 added #b refines #a\n')
  expect(project.run(['retitle', 'a', 'Use an append-only log']).code).toBe(0)

  const shown = project.run(['show', 'a'])
  expect(shown.code).toBe(0)
  const page = JSON.parse(shown.stdout)
  expect(page.card.title).toBe('Use an append-only log')
  expect(page.children.map((c: { id: string }) => c.id)).toEqual(['b'])
  expect(page.children[0].stale).toEqual([{ because: 'a', seq: 3, via: 'refines' }])
})

test('each map command appends exactly one event, and the lines before it stay byte for byte', () => {
  project = makeProject()
  const log = join(project.dir, '.werk', 'log.jsonl')
  const read = () => {
    try {
      return readFileSync(log, 'utf8')
    } catch {
      return ''
    }
  }
  const commands = [
    ['add', 'a', '--title', 'Use a log', '--why', 'w'],
    ['add', 'b', '--title', 'Cards fold from it', '--parent', 'a'],
    ['add', 's', '--kind', 'source', '--title', 'Research', '--body', 'the finding'],
    ['add', 'a:opt0', '--kind', 'option', '--title', 'A snapshot', '--why-not', 'loses history'],
    ['link', 'a:opt0', 'a', '--type', 'alternative_to'],
    ['link', 'a', 's', '--type', 'supported_by'],
    ['retitle', 'a', 'Use an append-only log'],
    ['edit', 'a', '--body', 'Nothing is deleted.'],
    ['edit', 'a', '--who', 'you'],
    ['edit', 'a', '--no-basis', 'the root of the map'],
    ['edit', 'a', '--unchallenged', 'one way was seen'],
    ['kill', 'a', 'revisit at any time'],
    ['add', 'a:opt1', '--kind', 'option', '--title', 'A database', '--alternative-to', 'a'],
    ['status', 'a', 'decided'],
    ['status', 'a', 'open', '--why', 'postponed'],
    ['decide', 'a'],
    ['reopen', 'a', '--why', 'again'],
    ['say', 'a', 'keep every change', '--who', 'Eryk'],
    ['dispute', 's', '--why', 'old numbers'],
    ['remove', 'b'],
    ['restore', 'b'],
  ]
  for (const [i, args] of commands.entries()) {
    const before = read()
    const result = project.run(args)
    expect({ args, ...result }).toMatchObject({ args, code: 0, stderr: '' })
    const after = read()
    expect(after.startsWith(before)).toBe(true)
    const added = after.slice(before.length).split('\n').filter(Boolean)
    expect(added).toHaveLength(1)
    expect(JSON.parse(added[0]!).seq).toBe(i + 1)
  }
})

test('after a retitle, show prints only the new title, and the old title is still in the log', () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'Use a log'])
  project.run(['retitle', 'a', 'Use an append-only log'])
  const card = project.run(['show', 'a']).stdout
  const root = project.run(['show']).stdout
  for (const text of [card, root]) {
    expect(text).toContain('Use an append-only log')
    expect(text).not.toContain('"Use a log"')
  }
  const log = readFileSync(join(project.dir, '.werk', 'log.jsonl'), 'utf8')
  expect(log).toContain('"title":"Use a log"')
  expect(log).toContain('"title":"Use an append-only log"')
})

test('a write the map refuses exits 1, names the rule, and leaves the log as it was', () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  project.run(['add', 'a:opt0', '--kind', 'option', '--title', 'O', '--why-not', 'slow'])
  const result = project.run(['link', 'a:opt0', 'a', '--type', 'refines'])
  expect(result.code).toBe(1)
  expect(result.stderr).toBe('werk: an option has one link only: alternative_to, not refines\n')
  expect(project.run(['show', 'nope'])).toMatchObject({ code: 1, stderr: 'werk: no card #nope in the map\n' })
  expect(JSON.parse(project.run(['show']).stdout).children.map((c: { id: string }) => c.id)).toEqual(['a'])
})

test('serve in a project serves the client page, the project name, the folded map and the live channel', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  expect(server.output()).toContain(`serving ${project.dir} at http://localhost:${server.port}`)

  const page = await fetch(`http://localhost:${server.port}/`)
  expect(page.status).toBe(200)
  const html = await page.text()
  expect(html).toContain('<div id="root"></div>')
  expect(html).toContain('/@react-refresh')

  const name = project.dir.split('/').at(-1)
  expect(await (await fetch(`http://localhost:${server.port}/api/project`)).json()).toEqual({ name })

  project.run(['add', 'a', '--title', 'A'])
  const map = await (await fetch(`http://localhost:${server.port}/api/map`)).json()
  expect(map).toMatchObject({ seq: 1, cards: { a: { title: 'A' } }, problems: [] })

  const hello = await liveHello(server.port)
  expect(hello.pid).toBe(server.process.pid!)
  expect(hello.children).toEqual([])
}, 30_000)

test('a write from the command line pushes changed on the live channel, and the map then holds it', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  live = await openLive(server.port)
  await live.next('hello')

  expect(project.run(['add', 'a', '--title', 'A']).code).toBe(0)
  expect((await live.next('changed')).data).toEqual({})
  const map = await (await fetch(`http://localhost:${server.port}/api/map`)).json()
  expect(map).toMatchObject({ seq: 1, cards: { a: { title: 'A' } } })
}, 30_000)

test('the server has no route that writes: a POST, PUT, PATCH or DELETE to the map is refused', async () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  const before = readFileSync(join(project.dir, '.werk', 'log.jsonl'), 'utf8')
  server = await startServe(project.dir)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(`http://localhost:${server.port}/api/map`, { method, body: method === 'DELETE' ? null : '{"title":"B"}' })
    expect({ method, status: res.status }).toEqual({ method, status: 404 })
  }
  expect(readFileSync(join(project.dir, '.werk', 'log.jsonl'), 'utf8')).toBe(before)
}, 30_000)

test('an unknown API route is a 404, not the client page', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await fetch(`http://localhost:${server.port}/api/nope`)
  expect(res.status).toBe(404)
}, 30_000)

/** The log as text, or '' before the first write. */
function logText(dir: string): string {
  try {
    return readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8')
  } catch {
    return ''
  }
}

/** The fix commands a refusal prints: the indented lines that start with `werk `. */
const fixes = (stderr: string) =>
  stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('werk '))

/**
 * Runs a printed fix command as a shell runs it. Only the placeholders that a shell cannot
 * read are filled in; a quoted placeholder stays as the text it is.
 */
function runFix(dir: string, command: string): { code: number; stderr: string } {
  const filled = command.replace('<you|me|prototype>', 'me').replace('<card-it-needs>', 'base')
  const result = spawnSync('sh', ['-c', `werk() { "$WERK_BUN" "$WERK_CLI" "$@"; }; ${filled}`], {
    cwd: dir,
    env: testEnv({ WERK_BUN: process.execPath, WERK_CLI: CLI }),
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, stderr: result.stderr }
}

test('a decide with a missing fact exits 1, appends nothing, and prints the command that fixes it', () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A', '--who', 'me'])
  project.run(['edit', 'a', '--no-basis', 'the root of the map'])
  const before = logText(project.dir)
  const result = project.run(['status', 'a', 'decided'])
  expect(result.code).toBe(1)
  expect(result.stderr).toStartWith('werk: #a cannot be decided: 1 fact is missing.\n')
  expect(fixes(result.stderr)).toEqual(['werk kill a "<what must become true to revisit this decision>"'])
  expect(logText(project.dir)).toBe(before)

  expect(runFix(project.dir, fixes(result.stderr)[0]!).code).toBe(0)
  expect(project.run(['status', 'a', 'decided'])).toMatchObject({ code: 0, stderr: '' })
  expect(JSON.parse(project.run(['show', 'a']).stdout).card).toMatchObject({ status: 'decided', kill: ['<what must become true to revisit this decision>'] })
})

test('each missing fact prints its own command, and running each one in turn makes the decide pass', () => {
  project = makeProject()
  project.run(['add', 'base', '--title', 'Base', '--who', 'me'])
  project.run(['edit', 'base', '--no-basis', 'the root of the map'])
  project.run(['kill', 'base', 'revisit at any time'])
  expect(project.run(['decide', 'base']).code).toBe(0)
  project.run(['add', 'a', '--title', 'A'])

  const fixed: string[] = []
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = logText(project.dir)
    const result = project.run(['decide', 'a'])
    if (result.code === 0) break
    expect(logText(project.dir)).toBe(before)
    const [first] = fixes(result.stderr)
    fixed.push(first!.split(' ')[1]!)
    expect(runFix(project.dir, first!)).toMatchObject({ code: 0, stderr: '' })
    // Once who is me, flip it to you, so the option fact is asked for too.
    if (first!.startsWith('werk edit a --who')) expect(project.run(['edit', 'a', '--who', 'you']).code).toBe(0)
  }
  expect(fixed).toEqual(['edit', 'link', 'add', 'kill'])
  expect(JSON.parse(project.run(['show', 'a']).stdout).card.status).toBe('decided')
})

test('an amend of a decided card that removes a required fact is refused, and the log stays as it was', () => {
  project = makeProject()
  for (const args of [
    ['add', 'a', '--title', 'A', '--who', 'you'],
    ['edit', 'a', '--no-basis', 'the root of the map'],
    ['kill', 'a', 'revisit at any time'],
    ['add', 'a:opt0', '--kind', 'option', '--title', 'O', '--why-not', 'slow', '--alternative-to', 'a'],
    ['decide', 'a'],
  ]) {
    expect({ args, ...project.run(args) }).toMatchObject({ args, code: 0 })
  }
  const before = logText(project.dir)
  const removed = project.run(['remove', 'a:opt0'])
  expect(removed.code).toBe(1)
  expect(removed.stderr).toStartWith('werk: the change to #a is refused: #a is decided, and after it 1 fact is missing.\n')
  expect(fixes(removed.stderr)).toEqual(['werk add a:opt1 --kind option --title "<the alternative>" --why-not "<why it lost>" --alternative-to a'])
  expect(logText(project.dir)).toBe(before)
  // An amend that keeps every fact goes through.
  expect(project.run(['retitle', 'a', 'A, renamed']).code).toBe(0)
})

test('adding a card and setting it open are not checked', () => {
  project = makeProject()
  expect(project.run(['add', 'a', '--title', 'A'])).toMatchObject({ code: 0, stderr: '' })
  expect(project.run(['add', 'b', '--title', 'B', '--parent', 'a'])).toMatchObject({ code: 0, stderr: '' })
  // A card decided before the contract existed can still be set open.
  const log = join(project.dir, '.werk', 'log.jsonl')
  const seq = logText(project.dir).trim().split('\n').length
  const legacy = JSON.stringify({ type: 'decided', id: 'a', seq: seq + 1, at: '2026-10-19T00:00:00.000Z' })
  appendFileSync(log, `${legacy}\n`)
  expect(project.run(['status', 'a', 'open', '--why', 'postponed'])).toMatchObject({ code: 0, stderr: '' })
})

test('on a card decided before the contract, a retitle waits, and each printed fix goes through', () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  appendFileSync(join(project.dir, '.werk', 'log.jsonl'), `${JSON.stringify({ type: 'decided', id: 'a', seq: 2, at: '2026-10-19T00:00:00.000Z' })}\n`)
  const refused = project.run(['retitle', 'a', 'A, renamed'])
  expect(refused.code).toBe(1)
  for (const fix of fixes(refused.stderr)) {
    const command = fix.startsWith('werk link') ? 'werk edit a --no-basis "the root of the map"' : fix
    expect({ command, ...runFix(project.dir, command) }).toMatchObject({ command, code: 0 })
  }
  expect(project.run(['retitle', 'a', 'A, renamed'])).toMatchObject({ code: 0, stderr: '' })
})
