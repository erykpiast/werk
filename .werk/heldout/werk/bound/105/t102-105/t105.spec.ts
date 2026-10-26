/** Held-out steps 105.1 to 105.5: asks, running dots and deaths of background tabs. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { addCards, chatRuns, dotStyle, navigate, openAppAt, parts, RED, reply, result, say, init, send, STANDARD, tabsAt, YELLOW } from './helpers.ts'

const ask = { ask: { id: 'r1', tool: 'Bash', input: { command: 'ls' } } }
const answers = (inputs: unknown[]) => inputs.filter((m) => (m as { type?: string }).type === 'control_response')

/** Tabs #alpha and #beta. #alpha has a conversation with one reply. #beta's agent plays `betaReply`. #alpha is read. */
async function alphaBeta(page: Page, werk: Werk, betaSteps: Parameters<typeof reply>[1] | null, betaReply?: Parameters<Werk['scriptAgent']>[0]) {
  addCards(werk, STANDARD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Alpha here.')] } })
  await tabsAt(page, werk, ['alpha', 'beta'])
  const { chips, transcript } = parts(page)
  await send(page, 'Hello alpha')
  await expect(transcript).toContainText('Alpha here.')
  werk.scriptAgent(betaReply ?? { steps: [], roles: { chat: [{ steps: betaSteps! }] } })
  await chips.nth(1).click()
  await send(page, 'Hello beta')
  await expect.poll(() => chatRuns(werk).length).toBe(2)
  await chips.nth(0).click()
  await expect(parts(page).card).toHaveAttribute('data-card-id', 'alpha')
}

test('105.1 An ask in a background tab stays on its own tab', async ({ page, werk }) => {
  const gate = join(werk.dir, 'gate-105-1')
  await alphaBeta(page, werk, [init(), { waitFor: gate }, ask, say('Beta done.'), result])
  const { chat, chips, transcript } = parts(page)
  const alphaItems = await transcript.getByRole('listitem').count()
  const alphaText = await transcript.innerText()
  writeFileSync(gate, '')

  const beta = chat.getByRole('tab', { name: '#beta' })
  await expect(beta).toHaveAttribute('data-state', 'waiting')
  const style = await dotStyle(beta)
  expect(style.color).toBe(YELLOW)
  expect(style.animation).toBe('blink')
  await expect(chat.getByRole('region', { name: 'permission ask' })).toHaveCount(0)
  await expect(chat.locator('.dead-lines')).toHaveCount(0)
  await expect(transcript.getByRole('listitem')).toHaveCount(alphaItems)
  expect(await transcript.innerText()).toBe(alphaText)

  await beta.click()
  const bar = chat.getByRole('region', { name: 'permission ask' })
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Bash')
  await bar.getByRole('button', { name: 'Allow once' }).click()
  await expect(transcript).toContainText('Beta done.')
  const [alphaRun, betaRun] = chatRuns(werk)
  const betaAnswers = answers(betaRun!.inputs) as { response: { request_id: string; response: { behavior: string } } }[]
  expect(betaAnswers).toHaveLength(1)
  expect(betaAnswers[0]!.response.request_id).toBe('r1')
  expect(betaAnswers[0]!.response.response.behavior).toBe('allow')
  expect(answers(alphaRun!.inputs)).toHaveLength(0)
  expect(alphaRun!.inputs).toHaveLength(1)
  await expect(beta).not.toHaveAttribute('data-state', 'waiting')
  expect((await dotStyle(beta)).color).not.toBe(YELLOW)
  await chips.nth(0).click()
  await expect(transcript.getByRole('listitem')).toHaveCount(alphaItems)
})

test("105.2 A parked tab with an ask makes the '…' button blink", async ({ page, werk }) => {
  addCards(werk, STANDARD)
  const gate = join(werk.dir, 'gate-105-2')
  werk.scriptAgent({ steps: [], roles: { chat: [{ steps: [init(), say('One.'), result, { waitFor: gate }, ask] }] } })
  await openAppAt(page, werk, 'alpha')
  const { chat, chips, more, menu, transcript } = parts(page)
  await send(page, 'Start')
  await expect(transcript).toContainText('One.')
  for (const card of ['beta', 'gamma', 'werk-mc-fork', 'werk-mc-split', 'werk-mc-tabs']) {
    await navigate(page, werk, card)
    await chat.getByRole('button', { name: 'New empty conversation' }).click()
    await expect(chat.getByRole('tab', { name: `#${card}` })).toHaveAttribute('aria-selected', 'true')
  }
  await expect(chips).toHaveCount(5)
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveCount(0)

  writeFileSync(gate, '')
  await expect(more).toHaveAttribute('data-blink', 'waiting')
  expect(await more.evaluate((el) => getComputedStyle(el).animationName)).toBe('blink')
  await expect(chat.getByRole('region', { name: 'permission ask' })).toHaveCount(0)

  await more.click()
  await menu.getByRole('menuitem', { name: /#alpha/ }).click()
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveAttribute('aria-selected', 'true')
  const bar = chat.getByRole('region', { name: 'permission ask' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Allow once' }).click()
  await expect(more).not.toHaveAttribute('data-blink', /.+/)
})

test('105.3 A running tab shows a dot on its chip and its home card, also with a background agent', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  const mainEnd = join(werk.dir, 'gate-main-end')
  const bgEnd = join(werk.dir, 'gate-bg-end')
  const bg = (n: number) => ({ event: { type: 'system', subtype: 'background_tasks_changed', tasks: Array.from({ length: n }, (_, i) => ({ id: `bg${i}` })) } })
  werk.scriptAgent({ steps: [], roles: { chat: [{ steps: [init(), bg(1), say('Working.'), { waitFor: mainEnd }, result, { waitFor: bgEnd }, bg(0)] }] } })
  // Tabs: one on #root, whose tree lists #beta, and one on #beta.
  await tabsAt(page, werk, ['root', 'beta'])
  const { chat, chips } = parts(page)
  const betaChip = chat.getByRole('tab', { name: '#beta' })
  const betaInTree = page.getByRole('list', { name: 'sub-cards' }).locator('li[data-card-id="beta"]')

  await chips.nth(1).click()
  await send(page, 'Go, and start a background agent')
  await chips.nth(0).click()
  await expect(parts(page).card).toHaveAttribute('data-card-id', 'root')
  await expect(betaChip).toHaveAttribute('data-state', 'running')
  await expect(betaInTree).toHaveAttribute('data-live', 'running')
  await expect(betaInTree.getByRole('img', { name: 'a conversation runs here' })).toBeVisible()

  writeFileSync(mainEnd, '')
  await chips.nth(1).click()
  await expect(chat.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()
  await chips.nth(0).click()
  await expect(betaChip).toHaveAttribute('data-state', 'running')
  await expect(betaInTree).toHaveAttribute('data-live', 'running')

  writeFileSync(bgEnd, '')
  await expect(betaChip).toHaveAttribute('data-state', 'idle')
  await expect(betaInTree).not.toHaveAttribute('data-live', /.+/)
  await expect(betaInTree.getByRole('img', { name: 'a conversation runs here' })).toHaveCount(0)
})

test('105.4 A crashed background child shows red and puts a line in the focused pane', async ({ page, werk }) => {
  const gate = join(werk.dir, 'gate-105-4')
  await alphaBeta(page, werk, [init(), say('Beta here.'), result, { waitFor: gate }, { crash: 1 }])
  const { chat } = parts(page)
  writeFileSync(gate, '')
  const beta = chat.getByRole('tab', { name: '#beta' })
  await expect(beta).toHaveAttribute('data-state', 'dead')
  expect((await dotStyle(beta)).color).toBe(RED)
  const line = chat.getByRole('list', { name: 'dead conversations' }).getByRole('listitem')
  await expect(line).toHaveCount(1)
  await expect(line).toContainText('#beta')
  await expect(line).toContainText('died')
})

test('105.5 Red wins over yellow when a child with a pending ask dies', async ({ page, werk }) => {
  const g1 = join(werk.dir, 'gate-105-5a')
  const g2 = join(werk.dir, 'gate-105-5b')
  await alphaBeta(page, werk, [init(), { waitFor: g1 }, ask, { waitFor: g2 }, { crash: 1 }])
  const { chat } = parts(page)
  const beta = chat.getByRole('tab', { name: '#beta' })
  writeFileSync(g1, '')
  await expect(beta).toHaveAttribute('data-state', 'waiting')
  expect((await dotStyle(beta)).color).toBe(YELLOW)
  writeFileSync(g2, '')
  await expect(beta).toHaveAttribute('data-state', 'dead')
  expect((await dotStyle(beta)).color).toBe(RED)
  expect((await dotStyle(beta)).color).not.toBe(YELLOW)
  const line = chat.getByRole('list', { name: 'dead conversations' }).getByRole('listitem')
  await expect(line).toContainText('#beta')
})
