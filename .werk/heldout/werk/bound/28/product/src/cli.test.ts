import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
