/** Held-out steps 65.1-65.5: reopen marks, in the stale list (CLI) and on the map (browser). */
import { expect, test, type Werk } from '../../e2e/harness.ts'

const tile = (id: string) => `li[data-card-id="${id}"] > a`
const markOn = (id: string, kind?: string) => `${tile(id)} > .mark${kind ? `[data-mark="${kind}"]` : ''}`

/** A real card, open, with an optional parent. */
function card(werk: Werk, id: string, parent?: string) {
  werk.cli(['add', id, '--title', `Card ${id}`, ...(parent ? ['--parent', parent] : [])])
  werk.cli(['accept', id, '--actor', 'you'])
}

/** A real card with the decide facts on record, then decided. */
function decided(werk: Werk, id: string, parent?: string) {
  card(werk, id, parent)
  werk.cli(['edit', id, '--who', 'me', '--no-basis', 'a test card'])
  werk.cli(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  werk.cli(['status', id, 'decided'])
}

const dependsOn = (werk: Werk, from: string, to: string) => werk.cli(['link', from, to, '--type', 'depends_on'])

/** The block of the stale list for one card: its head line and its trace lines. */
function entry(list: string, id: string): string | undefined {
  const lines = list.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^(stale|paused)\\s+#${id}\\s`).test(l))
  if (at === -1) return undefined
  const block = [lines[at]!]
  for (let i = at + 1; i < lines.length && lines[i]!.startsWith('  '); i++) block.push(lines[i]!)
  return block.join('\n')
}

test('65.1 A rejected reopen marks only the next hop as stale', async ({ page, werk }) => {
  for (const id of ['pa', 'pb', 'pc']) decided(werk, id)
  dependsOn(werk, 'pb', 'pa')
  dependsOn(werk, 'pc', 'pb')
  werk.cli(['reopen', 'pa', '--reason', 'rejected', '--why', 'the storage choice is wrong'])

  const list = werk.cli(['stale'])
  const b = entry(list, 'pb')
  expect(b, list).toBeDefined()
  expect(b!).toMatch(/^stale\s+#pb/)
  expect(b!).toContain('rejected #pa')
  expect(b!).toContain('depends_on')
  expect(list).not.toContain('#pc')

  await expect(page.locator(tile('pb'))).toBeVisible()
  await expect(page.locator(markOn('pb', 'stale'))).toHaveCount(1)
  await expect(page.locator(tile('pc'))).toBeVisible()
  await expect(page.locator(markOn('pc', 'stale'))).toHaveCount(0)
  await expect(page.locator(markOn('pc', 'paused'))).toHaveCount(0)
})

test('65.2 A postponed reopen pauses every downstream card and keeps their status', async ({ page, werk }) => {
  for (const id of ['pa', 'pb', 'pc', 'pd']) decided(werk, id)
  dependsOn(werk, 'pb', 'pa')
  dependsOn(werk, 'pc', 'pb')
  dependsOn(werk, 'pd', 'pc')
  werk.cli(['reopen', 'pa', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])

  for (const id of ['pb', 'pc', 'pd']) await expect(page.locator(markOn(id, 'paused'))).toHaveCount(1)
  await expect(page.locator(tile('pd'))).toHaveAttribute('data-status', 'decided')
  expect(werk.cli(['show', 'pd'])).toContain('status: decided')

  const list = werk.cli(['stale'])
  const d = entry(list, 'pd')
  expect(d, list).toBeDefined()
  expect(d!).toMatch(/^paused\s+#pd/)
  expect(d!).toContain('postponed #pa')

  await expect(page.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  expect(list).not.toMatch(/^stale\s/m)
})

test('65.3 Stale wins when a postponement and a rejection reach the same card', async ({ page, werk }) => {
  decided(werk, 'pa')
  decided(werk, 'pb')
  decided(werk, 'pc', 'pb')
  dependsOn(werk, 'pc', 'pa')
  werk.cli(['reopen', 'pa', '--reason', 'postponed', '--why', 'wait for pa'])
  werk.cli(['reopen', 'pb', '--reason', 'rejected', '--why', 'pb is wrong'])

  await expect(page.locator(markOn('pc', 'stale'))).toHaveCount(1)
  await expect(page.locator(markOn('pc', 'paused'))).toHaveCount(0)

  const list = werk.cli(['stale'])
  const c = entry(list, 'pc')
  expect(c, list).toBeDefined()
  expect(c!).toMatch(/^stale\s+#pc/)
  expect(c!).toContain('rejected #pb')
})

test('65.4 Rederive clears the mark on one card and leaves the others', async ({ page, werk }) => {
  for (const id of ['pa', 'pb', 'pc']) decided(werk, id)
  dependsOn(werk, 'pb', 'pa')
  dependsOn(werk, 'pc', 'pa')
  werk.cli(['reopen', 'pa', '--reason', 'rejected', '--why', 'pa is wrong'])
  const before = werk.cli(['stale'])
  expect(entry(before, 'pb')).toMatch(/^stale\s+#pb/)
  expect(entry(before, 'pc')).toMatch(/^stale\s+#pc/)

  werk.cli(['rederive', 'pb', 'confirm', '--why', 'pb still holds'])
  const list = werk.cli(['stale'])
  expect(list).not.toContain('#pb')
  const c = entry(list, 'pc')
  expect(c, list).toBeDefined()
  expect(c!).toMatch(/^stale\s+#pc/)
  expect(c!).toContain('rejected #pa')

  await expect(page.locator(tile('pb'))).toBeVisible()
  await expect(page.locator(markOn('pb', 'stale'))).toHaveCount(0)
})

test('65.5 Deciding a postponed card again clears the paused marks downstream', async ({ page, werk }) => {
  decided(werk, 'pa')
  card(werk, 'pb')
  card(werk, 'pc')
  werk.cli(['status', 'pc', 'proto'])
  dependsOn(werk, 'pb', 'pa')
  dependsOn(werk, 'pc', 'pb')
  werk.cli(['reopen', 'pa', '--reason', 'postponed', '--why', 'later'])
  await expect(page.locator(markOn('pb', 'paused'))).toHaveCount(1)
  await expect(page.locator(markOn('pc', 'paused'))).toHaveCount(1)

  werk.cli(['status', 'pa', 'decided'])
  await expect(page.locator(markOn('pb', 'paused'))).toHaveCount(0)
  await expect(page.locator(markOn('pc', 'paused'))).toHaveCount(0)
  const list = werk.cli(['stale'])
  expect(list).not.toContain('#pb')
  expect(list).not.toContain('#pc')
  await expect(page.locator(tile('pc'))).toHaveAttribute('data-status', 'proto')
  expect(werk.cli(['show', 'pc'])).toContain('status: proto')
})
