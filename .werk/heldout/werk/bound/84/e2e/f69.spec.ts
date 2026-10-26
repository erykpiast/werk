/** Feature 69: the map in a browser, live redraw, the open card, one server per project. */
import { readFileSync } from 'node:fs'
import { accepted, proposed } from '../../src/test/map-events.ts'
import { expect, open, test } from './harness.ts'

const li = (id: string) => `li[data-card-id="${id}"]`
const tree = () => [
  proposed('root', { title: 'The root card' }),
  accepted('root'),
  proposed('child-a', { title: 'Child card A', parent: 'root' }),
  proposed('child-b', { title: 'Child card B', parent: 'root' }),
  proposed('grandchild', { title: 'The grandchild card', parent: 'child-a' }),
  accepted('child-a'),
  accepted('child-b'),
  accepted('grandchild'),
]

test('69.1 the map shows the fixture project as a refines tree', async ({ page, proj }) => {
  proj.seed(...tree())
  await open(page, proj)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${li('root')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')} > a`)).toContainText('Child card A')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-b')} > a`)).toContainText('Child card B')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')} > ul > ${li('grandchild')} > a`)).toContainText('The grandchild card')
  await expect(map.locator(`> ${li('root')} > ul > ${li('grandchild')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, proj }) => {
  proj.seed(...tree())
  await open(page, proj)
  await expect(page.locator(li('root'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  proj.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
  proj.cli(['accept', 'append-log', '--actor', 'you'])
  const drawn = page.locator(`${li('root')} > ul > ${li('append-log')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5_000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page, proj }) => {
  proj.seed(...tree(), { type: 'node.edited', payload: { id: 'child-a', body: 'The body of child A.' } })
  await open(page, proj)
  await page.locator(`${li('child-a')} > a`).click()
  await expect(page).toHaveURL(/#child-a$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'child-a')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Child card A')
  await expect(detail).toContainText('The body of child A.')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#child-a$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'child-a')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, proj }) => {
  proj.seed(...tree())
  const url = await proj.start()
  await page.goto(url)
  await expect(page.locator(li('grandchild'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))

  const firstPid = JSON.parse(readFileSync(`${proj.dir}/.werk/server.lock`, 'utf8')).pid as number
  const started = Date.now()
  const second = proj.spawnServe()
  const code = await new Promise<number | null>((resolve) => second.on('exit', (c) => resolve(c)))
  const took = Date.now() - started
  expect(second.err).toContain(`waiting for pid ${firstPid}`)
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8_000)
  const errorLines = second.err.split('\n').filter((l) => !l.includes('waiting'))
  expect(errorLines.join('\n')).toContain(String(firstPid))

  await page.goto(url)
  await expect(page.locator(li('grandchild'))).toBeVisible()
  const after = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
  console.log(`69.4 second server stopped after ${took} ms with code ${code}: ${second.err.trim()}`)
})
