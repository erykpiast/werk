import { afterAll, afterEach, expect, test } from 'bun:test'
import { closeBrowser, decidable, events, makeProject, must, openPage, runPrinted, show, startServe, type RunningServer, type TempProject } from './lib.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})
afterAll(closeBrowser)
const T = 60_000

/** The printed fix lines: every line of the failure output that starts with `werk `. */
const fixes = (out: string) => out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('werk '))
/** Fills each `<placeholder>` of a printed fix with a real value. */
const fill = (line: string, base: string) =>
  line
    .replace('<you|me|prototype>', 'you')
    .replace('<card-it-needs>', base)
    .replace(/<[^>]+>/g, 'a filled-in value')

/** The map page of a card in the browser: its detail text. */
async function pageText(id: string) {
  server ??= await startServe(project!.dir)
  const { page } = await openPage(`http://localhost:${server.port}/#${id}`)
  const detail = page.getByRole('region', { name: 'card detail' })
  await detail.waitFor({ timeout: 10_000 })
  const text = (await detail.textContent()) ?? ''
  await page.close()
  return text
}

test('03.1 a card with a missing fact cannot become decided, and the printed command fixes it', async () => {
  project = makeProject()
  decidable(project, 'x', 'Storage is a log')
  must(project, ['decide', 'x'])
  must(project, ['add', 'c', '--title', 'Cards fold from it', '--who', 'you'])
  must(project, ['link', 'c', 'x', '--type', 'depends_on', '--why', 'the log'])
  must(project, ['add', 'c:opt0', '--kind', 'option', '--title', 'A database', '--why-not', 'no history', '--alternative-to', 'c'])
  const before = events(project).length

  const r = project.run(['decide', 'c'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  console.log(`03.1 refusal:\n${out}`)
  expect(out).toMatch(/kill criteri/)
  const printed = fixes(out)
  expect(printed).toHaveLength(1)
  expect(printed[0]).toMatch(/^werk kill c /)
  expect(show(project, 'c').json.card.status).toBe('open')
  expect(await pageText('c')).toContain('open')
  expect(events(project).length).toBe(before)

  const fix = runPrinted(project, printed[0]!.replace(/"<[^>]+>"/, '"the fold gets too slow"'))
  expect(fix.code).toBe(0)
  const again = project.run(['decide', 'c'])
  expect(again.code).toBe(0)
  expect(show(project, 'c').json.card.status).toBe('decided')
  expect(await pageText('c')).toContain('decided')
}, T)

test('03.2 each missing fact prints its own fixing command', async () => {
  project = makeProject()
  decidable(project, 'x', 'Storage is a log')
  must(project, ['decide', 'x'])
  const full = (id: string, skip: 'who' | 'basis' | 'options' | 'kill') => {
    must(project!, ['add', id, '--title', `Card ${id}`, ...(skip === 'who' ? [] : ['--who', 'you'])])
    if (skip !== 'basis') must(project!, ['link', id, 'x', '--type', 'depends_on', '--why', 'the log'])
    if (skip !== 'options') must(project!, ['add', `${id}:opt0`, '--kind', 'option', '--title', `Not ${id}`, '--why-not', 'lost', '--alternative-to', id])
    if (skip !== 'kill') must(project!, ['kill', id, 'the log changes'])
  }
  full('c1', 'who')
  full('c2', 'basis')
  full('c3', 'options')
  full('c4', 'kill')

  const printed: string[] = []
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const before = events(project).length
    const r = project.run(['status', id, 'decided'])
    expect(r.code).not.toBe(0)
    expect(events(project).length).toBe(before)
    const f = fixes(r.stdout + r.stderr)
    console.log(`03.2 ${id}: ${f.join(' | ')}`)
    expect(f).toHaveLength(1)
    printed.push(f[0]!)
  }
  expect(new Set(printed).size).toBe(4)
  expect(printed[0]).toMatch(/--who/)
  expect(printed[1]).toMatch(/depends_on/)
  expect(printed[2]).toMatch(/--kind option/)
  expect(printed[3]).toMatch(/^werk kill/)

  printed.forEach((line, i) => {
    const r = runPrinted(project!, fill(line, 'x'))
    if (r.code !== 0) console.log(`03.2 fix ${i + 1} failed: ${r.stderr}`)
    expect(r.code).toBe(0)
  })
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    const r = project.run(['status', id, 'decided'])
    if (r.code !== 0) console.log(`03.2 decide ${id} again failed: ${r.stderr}`)
    expect(r.code).toBe(0)
    expect(show(project, id).json.card.status).toBe('decided')
  }
}, T)

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async () => {
  project = makeProject()
  must(project, ['add', 'c', '--title', 'Use an append-only log', '--who', 'you'])
  must(project, ['kill', 'c', 'the log gets too large'])
  expect(project.run(['edit', 'c', '--no-basis', 'it is the first decision of the project']).code).toBe(0)
  expect(project.run(['edit', 'c', '--unchallenged', 'no other storage was named']).code).toBe(0)
  const r = project.run(['status', 'c', 'decided'])
  expect(r.code).toBe(0)
  const card = show(project, 'c').json.card
  expect(card.status).toBe('decided')
  expect(card.noBasis).toBe('it is the first decision of the project')
  expect(card.unchallenged).toBe('no other storage was named')
  const text = await pageText('c')
  console.log(`03.3 page detail: ${text}`)
  expect(text).toContain('decided')
  expect(text).toContain('it is the first decision of the project')
  expect(text).toContain('no other storage was named')
}, T)

test('03.4 an amend of a decided card cannot remove a required fact', async () => {
  project = makeProject()
  decidable(project, 'c', 'Use an append-only log', ['--body', 'The first text.'])
  must(project, ['decide', 'c'])
  const before = events(project).length

  // When: the agent amends the card to remove its kill criteria. The CLI has no verb that
  // removes a kill criterion; this tries the closest form, an edit of the kill field.
  const r = project.run(['edit', 'c', '--kill', ''])
  const out = r.stdout + r.stderr
  console.log(`03.4 remove-kill attempt (exit ${r.code}):\n${out}`)
  expect(r.code).not.toBe(0)
  const amendEvents = events(project).length - before
  expect(amendEvents).toBe(0)
  const card = show(project, 'c').json.card
  expect(card.kill).toEqual(['the test map changes'])
  expect(card.status).toBe('decided')

  const body = project.run(['edit', 'c', '--body', 'The second text.'])
  expect(body.code).toBe(0)
  expect(show(project, 'c').json.card.body).toBe('The second text.')
  const text = await pageText('c')
  console.log(`03.4 page detail: ${text}`)
  expect(text).toContain('The second text.')
  expect(text).toContain('the test map changes')
  expect(text).toContain('decided')
  // The refusal must print the command that supplies the kill criteria.
  expect(out).toMatch(/werk kill c /)
}, T)

test('03.5 adding a card and setting it open are not checked', async () => {
  project = makeProject()
  const add = project.run(['add', 'c', '--title', 'Use an append-only log', '--body', 'One event per line.'])
  expect(add.code).toBe(0)
  expect(show(project).json.children.map((c: { id: string }) => c.id)).toContain('c')
  expect(await pageText('c')).toContain('Use an append-only log')

  // When: the agent sets the card to open. `status <id> open` needs --why; both forms are tried.
  const bare = project.run(['status', 'c', 'open'])
  const withWhy = project.run(['status', 'c', 'open', '--why', 'still being weighed'])
  console.log(`03.5 status open: exit ${bare.code} "${bare.stderr.split('\n')[0]}"; with --why: exit ${withWhy.code} "${withWhy.stderr.split('\n')[0]}"`)
  const decided = project.run(['status', 'c', 'decided'])
  expect(decided.code).not.toBe(0)
  expect(show(project, 'c').json.card.status).toBe('open')
  expect(bare.code === 0 || withWhy.code === 0).toBe(true)
}, T)
