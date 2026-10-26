import { afterEach, expect, test } from 'bun:test'
import { makeProject, liveHello, startServe, type RunningServer, type TempProject } from '../test/harness.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
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
  expect(project.run(['add', 'b', '--title', 'Cards fold from it', '--parent', 'a']).stdout).toBe('2 added #b\n3 linked #b refines #a\n')
  expect(project.run(['retitle', 'a', 'Use an append-only log']).code).toBe(0)

  const shown = project.run(['show', 'a'])
  expect(shown.code).toBe(0)
  const page = JSON.parse(shown.stdout)
  expect(page.card.title).toBe('Use an append-only log')
  expect(page.children.map((c: { id: string }) => c.id)).toEqual(['b'])
  expect(page.children[0].stale).toEqual([{ because: 'a', seq: 4, via: 'refines' }])
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

test('an unknown API route is a 404, not the client page', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await fetch(`http://localhost:${server.port}/api/nope`)
  expect(res.status).toBe(404)
}, 30_000)
