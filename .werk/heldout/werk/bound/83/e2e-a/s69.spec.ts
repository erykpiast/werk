import { spawn } from 'node:child_process'
import { seedLog, acc, addressOf, expect, MAIN, prop, stop, test } from './harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const tree = [
  prop('root', 'The root card', { body: 'Root body' }),
  acc('root'),
  prop('child-a', 'Child A', { parent: 'root', body: 'Body of child A' }),
  acc('child-a'),
  prop('child-b', 'Child B', { parent: 'root' }),
  acc('child-b'),
  prop('grand', 'Grandchild under A', { parent: 'child-a' }),
  acc('grand'),
]

test.describe('69.1', () => {
  test.use({ seed: seedLog(tree) })
  test('69.1 the map shows the refines tree', async ({ page }) => {
    const map = page.getByRole('list', { name: 'map' })
    await expect(map.locator(`> ${card('root')} > a`)).toContainText('The root card')
    await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > a`)).toContainText('Child A')
    await expect(map.locator(`> ${card('root')} > ul > ${card('child-b')} > a`)).toContainText('Child B')
    await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > ul > ${card('grand')} > a`)).toContainText('Grandchild under A')
    await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
  })
})

test.describe('69.2', () => {
  test.use({ seed: seedLog(tree) })
  test('69.2 a card added and accepted on the CLI appears with no reload', async ({ page, werk }) => {
    await expect(page.locator(card('root'))).toBeVisible()
    await expect(page.getByText('Use an append-only log')).toHaveCount(0)
    await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
    werk.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
    werk.cli(['accept', 'append-log', '--actor', 'you'])
    const drawn = page.locator(`${card('root')} > ul > ${card('append-log')}`)
    await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
    await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
    expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
  })
})

test.describe('69.3', () => {
  test.use({ seed: seedLog(tree) })
  test('69.3 the open card survives a reload and has no edit control', async ({ page }) => {
    await page.locator(`${card('child-a')} > a`).click()
    await expect(page).toHaveURL(/#child-a$/)
    const detail = page.getByTestId('card')
    await expect(detail).toHaveAttribute('data-card-id', 'child-a')
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Child A')
    await expect(detail).toContainText('Body of child A')
    await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'child-a')
    await expect(page).toHaveURL(/#child-a$/)
  })
})

test.describe('69.4', () => {
  test.use({ seed: seedLog(tree) })
  test('69.4 a second server waits, then refuses', async ({ page, werk }) => {
    await expect(page.locator(card('child-b'))).toBeVisible()
    const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env: werk.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    second.stderr.on('data', (c: Buffer) => (err += c.toString()))
    const started = Date.now()
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => {
        void stop(second)
        resolve(-999)
      }, 10_000)
      second.on('exit', (c) => {
        clearTimeout(t)
        resolve(c)
      })
    })
    const took = Date.now() - started
    console.log(`second server: exit ${code} after ${took}ms, first pid ${werk.pid}\n${err}`)
    expect(err).toContain(`waiting for pid ${werk.pid}`)
    expect(code).not.toBe(0)
    expect(code).not.toBe(-999)
    expect(took).toBeLessThan(8000)
    expect(err).toMatch(new RegExp(`pid ${werk.pid}\\)`))
    await page.goto(werk.url)
    const map = page.getByRole('list', { name: 'map' })
    await expect(map.locator('li')).toHaveCount(4)
    await expect(map.locator(`${card('grand')}`)).toBeVisible()
  })
})
// unused import guard
void addressOf
