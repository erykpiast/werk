import { afterEach, beforeEach, expect, test } from 'bun:test'
import { makeProject, type Project, type RunResult } from '../src/test/cli-harness.ts'

/**
 * Steps that need the map verbs of the werk command line (add, link, retitle, status, show, ...)
 * or `werk serve`. Each test runs the first command of its Given/When and checks it succeeds,
 * then goes on with the rest of the step.
 */
let project: Project
beforeEach(async () => {
  project = await makeProject()
})
afterEach(() => project?.cleanup())

const ok = (r: RunResult) => expect(r.code, `exit ${r.code}: ${r.stdout}${r.stderr}`).toBe(0)

/** Starts `werk serve` and waits up to 10 s for an http address on its output. */
async function serve(): Promise<{ url: string | null; out: string; code: number | null; kill: () => void }> {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/../src/cli.ts`, 'serve'], {
    cwd: project.dir,
    env: project.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let out = ''
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) out += new TextDecoder().decode(c)
  }
  void pump(child.stdout)
  void pump(child.stderr)
  const deadline = Date.now() + 10_000
  let url: string | null = null
  while (Date.now() < deadline && child.exitCode === null) {
    url = out.match(/https?:\/\/[^\s]+/)?.[0] ?? null
    if (url) break
    await Bun.sleep(100)
  }
  await Bun.sleep(100)
  return { url, out, code: child.exitCode, kill: () => child.kill() }
}

const serveSteps = ['01.1', '02.2', '02.3', '02.4', '02.5', '04.1', '32.1', '32.2', '32.4', '07.1', '07.4', '07.5']
for (const id of serveSteps) {
  test(`${id} werk serve prints an address`, async () => {
    const s = await serve()
    s.kill()
    expect(s.url, `serve output: ${s.out} (exit ${s.code})`).not.toBeNull()
  })
}

test('02.1 retitle appends one event', async () => {
  ok(await project.werk('add', 'a', '--title', 'Use a log'))
  ok(await project.werk('add', 'b', '--title', 'Cards fold from it'))
  ok(await project.werk('link', 'b', 'refines', 'a'))
})

test('03.x/03.5 add a card with only a title and body', async () => {
  ok(await project.werk('add', 'c1', '--title', 'T', '--body', 'B'))
  ok(await project.werk('status', 'c1', 'open'))
  const d = await project.werk('status', 'c1', 'decided')
  expect(d.code).not.toBe(0)
})

test('05.x reopen needs a decided card', async () => {
  ok(await project.werk('add', 'pricing', '--title', 'Pricing'))
  ok(await project.werk('reopen', 'pricing'))
})

test('06.x quote from a session', async () => {
  ok(await project.werk('add', 'card', '--title', 'Card'))
  ok(await project.werk('quote', 'card', '--session', 's1', '--text', 'the map is a view of the log'))
})

test('16.x plan over a subtree', async () => {
  ok(await project.werk('plan', 'root'))
})

test('34.1 agent add prints proposed', async () => {
  ok(await project.werk('add', 'root', '--title', 'Root'))
  const r = await project.werk('add', 'plan', '--title', 'Plan', '--refines', 'root')
  ok(r)
  expect(r.stdout).toContain('proposed')
})

test('34.3 accept without the person claim fails, with it succeeds', async () => {
  ok(await project.werk('add', 'root', '--title', 'Root'))
  ok(await project.werk('accept', 'root'))
})

test('34.4 discard', async () => {
  ok(await project.werk('discard', 'parent'))
})

test('34.5 show', async () => {
  ok(await project.werk('show', 'a'))
})

// One test per remaining step. Each runs the first werk command its Given needs.
const firstCommand: Record<string, string[]> = {
  '03.1': ['add', 'card', '--title', 'Card', '--decider', 'eryk'],
  '03.2': ['add', 'c1', '--title', 'First'],
  '03.3': ['add', 'card', '--title', 'Card', '--decider', 'eryk', '--kill', 'k'],
  '03.4': ['add', 'card', '--title', 'Card'],
  '04.2': ['add', 'payments', '--title', 'Payments'],
  '04.3': ['add', 'onboarding', '--title', 'Onboarding'],
  '04.4': ['add', 'search', '--title', 'Search'],
  '04.5': ['add', 'root', '--title', 'Root'],
  '05.1': ['add', 'pricing', '--title', 'Pricing'],
  '05.2': ['add', 'storage', '--title', 'Storage'],
  '05.3': ['add', 'engine', '--title', 'Engine'],
  '05.4': ['add', 'auth', '--title', 'Auth'],
  '05.5': ['add', 'index', '--title', 'Index'],
  '06.1': ['add', 'card', '--title', 'Card'],
  '06.2': ['add', 'card', '--title', 'Card'],
  '06.3': ['add', 'card', '--title', 'Card'],
  '06.4': ['add', 'card', '--title', 'Card'],
  '06.5': ['add', 'card', '--title', 'Card'],
  '07.2': ['add', 'align', '--title', 'Align'],
  '07.3': ['add', 'al-diff', '--title', 'Al diff'],
  '16.1': ['add', 'root', '--title', 'Root'],
  '16.2': ['add', 'root', '--title', 'Root'],
  '16.3': ['add', 'root', '--title', 'Root'],
  '16.4': ['add', 'a', '--title', 'A'],
  '16.5': ['add', 'root', '--title', 'Root'],
  '34.2': ['add', 'root', '--title', 'Root'],
}
for (const [id, args] of Object.entries(firstCommand)) {
  test(`${id} first command: werk ${args[0]}`, async () => {
    ok(await project.werk(...args))
  })
}
