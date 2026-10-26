/** Steps 100.1 - 100.5: the card wording rules in the system prompt of each chat conversation. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { writeFakeAgent } from '../../src/test/fake-bin.ts'
import { parts, reply, systemPrompt } from './common.ts'

const HEADING = '# werk — how to write a card on the map'

test('100.1 a new chat conversation starts with the card wording rules in its system prompt', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Hi.')] } })
  // The map holds at least one card: the fixture.
  await page.goto(werk.url)
  await expect(page.getByRole('list', { name: 'map' }).getByRole('link').first()).toBeVisible()
  const { chat, tabs, composer, transcript } = parts(page)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('hello')
  await composer.press('Enter')
  await expect(transcript).toContainText('Hi.')

  const launches = werk.agentLaunches()
  expect(launches).toHaveLength(1)
  const prompt = systemPrompt(launches[0]!)
  expect(prompt).toBeDefined()
  expect(prompt!).toContain(HEADING)
  expect(prompt!).toMatch(/A card describes its own subject, not the session that wrote it/)
  expect(prompt!).toMatch(/Do not write who said what/)
  expect(prompt!).toMatch(/Do not write edit history/)
})

test('100.2 the instructions forbid code names in card text', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await page.goto(`${werk.url}#map`)
  const { tabs, composer, transcript } = parts(page)
  await page.getByTestId('card').locator('..').getByRole('link', { name: /#map-hash/ }).click({ modifiers: ['Shift'] })
  await expect(tabs).toHaveCount(2)
  await composer.fill('What does this card say?')
  await composer.press('Enter')
  await expect(transcript).toContainText('Ok.')

  const launches = werk.agentLaunches()
  expect(launches).toHaveLength(1)
  const prompt = systemPrompt(launches[0]!)!
  expect(prompt).toContain(HEADING)
  expect.soft(prompt).toMatch(/A card names behaviour and concepts/)
  expect.soft(prompt).toMatch(/never names a source file, a function, a class, a constant, a line number or an internal endpoint/)
  expect.soft(prompt, 'the instructions say that a card does not list its child cards').toMatch(/child (cards|card)/i)
})

test('100.3 the instructions tell the agent to read a card from the map before it writes it', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Done.')] } })
  await page.goto(`${werk.url}#map-hash`)
  const { composer, transcript } = parts(page)
  await composer.fill('Change the body of #map-hash to say that the hash names the open card.')
  await composer.press('Enter')
  await expect(transcript).toContainText('Done.')
  const prompt = systemPrompt(werk.agentLaunches()[0]!)!
  expect(prompt).toContain(HEADING)
  expect(prompt).toMatch(/Read a card from the map before you write it/)
})

test('100.4 a second chat conversation also gets the instructions', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First reply.', 's-first')] } })
  await page.goto(`${werk.url}#map`)
  const { chat, tabs, composer, transcript } = parts(page)
  await composer.fill('One')
  await composer.press('Enter')
  await expect(transcript).toContainText('First reply.')

  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('Two')
  await composer.press('Enter')
  await expect(transcript).toContainText('First reply.')

  const launches = werk.agentLaunches()
  expect(launches).toHaveLength(2)
  const first = systemPrompt(launches[0]!)
  const second = systemPrompt(launches[1]!)
  expect(second).toBeDefined()
  expect(second!).toContain(HEADING)
  expect(second).toBe(first)
})

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')
const FIXTURE = join(import.meta.dirname, '..', '..', 'e2e', 'fixture-project')

test('100.5 a resumed conversation after a restart still carries the instructions', async ({ browser }) => {
  // This step restarts werk, so it runs its own werk on its own copy of the fixture project.
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-100-5-'))
  const dir = join(root, 'project')
  const bin = join(root, 'bin')
  cpSync(FIXTURE, dir, { recursive: true })
  writeFakeAgent(bin)
  const launchLog = join(root, 'launches.jsonl')
  const scriptPath = join(root, 'script.json')
  writeFileSync(launchLog, '')
  writeFileSync(scriptPath, JSON.stringify({ steps: [], roles: { chat: [reply('Earlier reply.', 's-keep'), reply('Later reply.', 's-keep')] } }))
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: scriptPath,
    WERK_FAKE_AGENT_LOG: launchLog,
    WERK_FAKE_AGENT_INPUT: join(root, 'input.jsonl'),
  }
  for (const args of [
    ['init', '--quiet', '--initial-branch=main'],
    ['config', 'user.name', 'werk test'],
    ['config', 'user.email', 'test@werk.invalid'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'The fixture'],
  ])
    spawnSync('git', args, { cwd: dir, env })
  const port = await freePort()
  let server: ChildProcess | undefined
  const startWerk = () =>
    new Promise<string>((resolve, reject) => {
      server = spawn('bun', [MAIN, 'serve', '--port', String(port)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      server.stderr!.on('data', (c: Buffer) => (err += c.toString()))
      server.stdout!.on('data', (c: Buffer) => {
        out += c.toString()
        const m = out.match(/http:\/\/\S+\//)
        if (m) resolve(m[0])
      })
      server.on('exit', (code) => reject(new Error(`werk serve exited ${code}: ${err}`)))
    })
  const stopWerk = async () => {
    if (!server || server.exitCode !== null) return
    const exited = new Promise((r) => server!.once('exit', r))
    server.kill('SIGTERM')
    await exited
  }
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    const url = await startWerk()
    await page.goto(`${url}#map`)
    const { composer, transcript } = parts(page)
    await composer.fill('First message')
    await composer.press('Enter')
    await expect(transcript).toContainText('Earlier reply.')

    // The user restarts werk: stops it and starts it again with the same command.
    await stopWerk()
    // A new agent process plays the replies from the first again, so the script now holds the later reply.
    writeFileSync(scriptPath, JSON.stringify({ steps: [], roles: { chat: [reply('Later reply.', 's-keep')] } }))
    const again = await startWerk()
    // A new werk process serves a new page (a new token); the user opens werk again at the same card.
    expect(again).toBe(url)
    await page.reload()
    await composer.fill('Second message')
    await composer.press('Enter')
    await expect(transcript).toContainText('Later reply.')
    await expect.soft(transcript, 'the transcript still shows the earlier reply').toContainText('Earlier reply.')

    const launches = readFileSync(launchLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] })
    expect(launches.length).toBeGreaterThanOrEqual(2)
    const resumed = launches.at(-1)!.argv
    console.log('100.5 resumed argv has --resume:', resumed.includes('--resume'))
    expect(systemPrompt(resumed)).toContain(HEADING)
  } finally {
    await context.close()
    await stopWerk()
    rmSync(root, { recursive: true, force: true })
  }
})
