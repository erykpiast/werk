// One real chat turn in a real browser: the composer POSTs to `werk serve`, the server spawns
// the fake `claude` that serve-fixture.ts put first on PATH (src/test/fake-claude.ts, mode ok),
// and the reply comes back over the SSE stream into the chat pane. This is the loop
// #werk-test-visual names — server, stream and child process — that map.spec.ts and
// board.spec.ts cut off by aborting /api/chat. Assertions are on structure only; the PNG is
// evidence, never a verdict — #werk-test-visual-judge.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE = join(import.meta.dirname, 'evidence')
mkdirSync(EVIDENCE, { recursive: true })
const evidence = (page: Page, name: string) => page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true })

test.beforeEach(async ({ page }) => {
  // The 3D graph loads its library from esm.sh. Kept offline, so a run never depends on it.
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
})

test('a sent message runs one turn through the fake claude child and the reply lands in the pane', async ({ page }) => {
  // Sent from the home on purpose: a turn pins `main` to the place it was sent from, and the
  // page then opens there on load. Any card would move `/` for the specs after this.
  await page.goto('/')
  await expect(page.locator('#sections .home-top h2').first()).toHaveText('Fixture map')

  // The server is shared by every spec file and keeps its conversation, so count from here.
  const log = page.locator('#chat-logs .chat-log:not([hidden])')
  const you = log.locator('.msg.you')
  const agent = log.locator('.msg.agent')
  const youBefore = await you.count()
  const agentBefore = await agent.count()

  const text = `ping from the e2e chat spec ${Date.now()}`
  const posted = page.waitForResponse((r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST')
  await page.locator('#chat-input').fill(text)
  await page.locator('#chat-input').press('Enter')
  expect((await posted).ok(), 'POST /api/chat was refused').toBe(true)

  // One message from you, one from the agent. The fake answers `echo <last line>` — a reply
  // only the child process on PATH can produce.
  await expect(you).toHaveCount(youBefore + 1)
  await expect(you.last()).toContainText(text)
  await expect(agent).toHaveCount(agentBefore + 1, { timeout: 15_000 })
  await expect(agent.last()).toContainText(`echo ${text}`)
  await expect(log.locator('.msg.failed')).toHaveCount(0)
  await expect(page.locator('#dead-bar')).toBeHidden()
  // The composer is free for the next turn.
  await expect(page.locator('#chat-input')).toHaveValue('')

  // The server's own record agrees with the pane: the turn is finished and both messages are in it.
  const history = await (await page.request.get('/api/chat/history')).json()
  expect(history.busy).toBe(false)
  const said = history.messages.filter((m: { from: string }) => m.from === 'you' || m.from === 'agent')
  expect(said.at(-2)).toMatchObject({ from: 'you' })
  expect(said.at(-2).text).toContain(text)
  expect(said.at(-1)).toMatchObject({ from: 'agent', text: `echo ${text}` })

  await evidence(page, 'chat-turn')
})

test('a turn that ends while the person reads higher up leaves the log where it is (#werk-mc-tab-bottom)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#sections .home-top h2').first()).toHaveText('Fixture map')
  const log = page.locator('#chat-logs .chat-log:not([hidden])')
  const agent = log.locator('.msg.agent')
  const agentBefore = await agent.count()

  // Hold the history reload that a finished turn starts, so the person can scroll first.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/chat/history*', async (route) => {
    await held
    await route.continue()
  })

  // A tall message, so the log overflows its box and there is a place higher up to read.
  const tall = Array.from({ length: 80 }, (_, i) => `line ${i} of a long message`).join('\n')
  await page.locator('#chat-input').fill(tall)
  await page.locator('#chat-input').press('Enter')
  await expect(agent).toHaveCount(agentBefore + 1, { timeout: 15_000 })

  const top = await log.evaluate((el) => {
    el.scrollTop = 40
    return el.scrollTop
  })
  expect(top).toBe(40)
  release()
  // The reload rebuilds the log; the position stays.
  await expect(log.locator('.msg.you').last()).toContainText('line 79 of a long message')
  await page.waitForTimeout(300)
  expect(await log.evaluate((el) => el.scrollTop)).toBe(40)
})
