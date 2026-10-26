import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { CLI, cleanup, decidedCard, env, logEvents, logText, makeProject, must, realCard, serve, show, werk, type Server } from './helpers'

let dir: string | undefined
let server: Server | undefined
test.afterEach(async () => {
  await server?.stop()
  cleanup(dir)
  server = undefined
  dir = undefined
})

/** The command lines a refusal printed. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk '))

/** Runs a printed command with its placeholders filled in, the way the agent would. */
function runPrinted(dir: string, cmd: string, fill: Record<string, string>) {
  let filled = cmd
  for (const [placeholder, value] of Object.entries(fill)) filled = filled.split(placeholder).join(value)
  expect(filled).not.toMatch(/<[^>]+>/)
  const r = spawnSync('sh', ['-c', filled.replace(/^werk /, `bun '${CLI}' `)], { cwd: dir, env: env(), encoding: 'utf8' })
  return { code: r.status, out: `ran: ${JSON.stringify(filled)}\n` + r.stdout + r.stderr }
}

async function pageStatus(page: Page, url: string, id: string) {
  await page.goto(`${url}/#${id}`)
  const s = page.getByRole('region', { name: 'card detail' }).locator('.meta .status').first()
  await expect(s).toBeVisible()
  return s
}

test('03.1 a missing kill criterion blocks decided, and the printed command fixes it', async ({ page }) => {
  dir = makeProject()
  decidedCard(dir, 'base', 'Storage is a log')
  realCard(dir, 'c', 'Fold on read', '--who', 'you')
  must(dir, 'link', 'c', 'base', '--type', 'depends_on', '--why', 'reads the log')
  must(dir, 'add', 'c:opt0', '--kind', 'option', '--title', 'Cache the map', '--why-not', 'two sources of truth', '--alternative-to', 'c')
  must(dir, 'accept', 'c:opt0', '--actor', 'you')
  server = await serve(dir)
  const before = logText(dir)
  const r = werk(dir, 'decide', 'c')
  expect(r.code).not.toBe(0)
  expect(r.out).toMatch(/kill criterion/)
  const cmds = printedCommands(r.out)
  expect(cmds).toHaveLength(1)
  expect(cmds[0]).toMatch(/^werk kill c /)
  expect(show(dir, 'c').card.status).toBe('open')
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('open')
  expect(logText(dir)).toBe(before)
  const fix = runPrinted(dir, cmds[0]!, { '<what must become true to revisit this decision>': 'the log outgrows memory' })
  expect(fix.code, fix.out).toBe(0)
  const again = werk(dir, 'decide', 'c')
  expect(again.code, again.out).toBe(0)
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('decided')
})

test('03.2 each missing fact prints its own fixing command', async ({ page }) => {
  dir = makeProject()
  decidedCard(dir, 'base', 'Storage is a log')
  // c1: no decider.
  realCard(dir, 'c1', 'No decider')
  must(dir, 'link', 'c1', 'base', '--type', 'depends_on')
  must(dir, 'kill', 'c1', 'revisit later')
  // c2: no basis and no stated lack of one.
  realCard(dir, 'c2', 'No basis', '--who', 'me')
  must(dir, 'kill', 'c2', 'revisit later')
  // c3: the person decides, no options and no unchallenged flag.
  realCard(dir, 'c3', 'No options', '--who', 'you')
  must(dir, 'link', 'c3', 'base', '--type', 'depends_on')
  must(dir, 'kill', 'c3', 'revisit later')
  // c4: no kill criteria.
  realCard(dir, 'c4', 'No kill', '--who', 'me')
  must(dir, 'link', 'c4', 'base', '--type', 'depends_on')
  const fill = {
    '<you|me|prototype>': 'me',
    '<card-it-needs>': 'base',
    '<what #c2 takes from it>': 'it needs storage',
    '<the alternative>': 'Something else',
    '<why it lost>': 'it costs more',
    '<what must become true to revisit this decision>': 'the need changes',
  }
  const ids = ['c1', 'c2', 'c3', 'c4']
  const facts = [/--who/, /--type depends_on/, /--kind option[\s\S]*--alternative-to c3/, /^werk kill c4/]
  const cmds: string[] = []
  for (const [i, id] of ids.entries()) {
    const before = logText(dir)
    const r = werk(dir, 'decide', id)
    expect(r.code, `${id}: ${r.out}`).not.toBe(0)
    expect(logText(dir)).toBe(before)
    const printed = printedCommands(r.out)
    expect(printed, `${id}: ${r.out}`).toHaveLength(1)
    expect(printed[0]).toMatch(facts[i]!)
    cmds.push(printed[0]!)
  }
  expect(new Set(cmds).size).toBe(4)
  const results: Record<string, string> = {}
  for (const [i, id] of ids.entries()) {
    const fix = runPrinted(dir, cmds[i]!, fill)
    expect(fix.code, fix.out).toBe(0)
    const again = werk(dir, 'decide', id)
    results[id] = again.code === 0 ? 'decided' : `refused: ${again.out.trim()}`
  }
  server = await serve(dir)
  for (const id of ids) {
    const s = await pageStatus(page, server.url, id)
    expect.soft(await s.textContent(), `${id}: ${results[id]}`).toBe('decided')
  }
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', async ({ page }) => {
  dir = makeProject()
  realCard(dir, 'c', 'Fold on read', '--who', 'you')
  must(dir, 'kill', 'c', 'revisit when it is slow')
  expect(werk(dir, 'edit', 'c', '--no-basis', 'it is the first decision of the project').code).toBe(0)
  expect(werk(dir, 'edit', 'c', '--unchallenged', 'no other way came up').code).toBe(0)
  const r = werk(dir, 'decide', 'c')
  expect(r.code, r.out).toBe(0)
  server = await serve(dir)
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('decided')
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect.soft(detail, 'the stated no-basis reason is visible').toContainText('it is the first decision of the project')
  await expect.soft(detail, 'the unchallenged flag is visible').toContainText(/unchallenged/i)
})

test('03.4 an amend of a decided card cannot remove a required fact', async ({ page }) => {
  dir = makeProject()
  decidedCard(dir, 'c', 'Fold on read', '--body', 'The first body.')
  server = await serve(dir)
  // The agent looks for a way to remove a kill criterion.
  const help = werk(dir, 'help').out
  const removeKill = help.split('\n').filter((l) => /kill/.test(l) && /remove|drop|delete|clear|--kill/.test(l))
  expect.soft(removeKill, `help text:\n${help}`).not.toEqual([])
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('decided')
  await expect.soft(page.getByRole('region', { name: 'card detail' }), 'the map shows the kill criteria').toContainText('revisit when the test changes')
  // The second half: a body-only amend keeps every fact.
  const before = logEvents(dir).length
  const r = werk(dir, 'edit', 'c', '--body', 'The new body.')
  expect(r.code, r.out).toBe(0)
  expect(logEvents(dir).length).toBe(before + 1)
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('decided')
  await expect(page.getByRole('region', { name: 'card detail' })).toContainText('The new body.')
})

test('03.5 adding a card and setting it open are not checked', async ({ page }) => {
  dir = makeProject()
  const add = werk(dir, 'add', 'c', '--title', 'Bare card', '--body', 'Only words.')
  expect(add.code, add.out).toBe(0)
  server = await serve(dir)
  await page.goto(server.url)
  await expect(page.getByRole('region', { name: 'sub-cards' }).getByText('Bare card')).toBeVisible()
  const open = werk(dir, 'status', 'c', 'open')
  expect.soft(open.code, `status c open: ${open.out}`).toBe(0)
  const decide = werk(dir, 'status', 'c', 'decided')
  expect(decide.code).not.toBe(0)
  expect(show(dir, 'c').card.status).toBe('open')
  await expect(await pageStatus(page, server.url, 'c')).toHaveText('open')
})
