import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, realCard, MAIN } from './harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`

test('69.1 the map shows the project as a refines tree', async ({ page, werk }) => {
  realCard(werk, 'root', 'The root card')
  realCard(werk, 'child-a', 'Child A', 'root')
  realCard(werk, 'child-b', 'Child B', 'root')
  realCard(werk, 'grand', 'Grandchild of A', 'child-a')
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > a`)).toContainText('Child A')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-b')} > a`)).toContainText('Child B')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > ul > ${card('grand')} > a`)).toContainText('Grandchild of A')
  await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  realCard(werk, 'root', 'The root card')
  await page.goto(werk.url)
  await expect(page.locator(card('root'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillSamePage: true }))
  werk.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
  werk.cli(['accept', 'append-log', '--actor', 'you'])
  const drawn = page.locator(`${card('root')} > ul > ${card('append-log')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillSamePage?: boolean }).stillSamePage)).toBe(true)
})

test('69.3 the open card survives a reload and has no text edit control', async ({ page, werk }) => {
  realCard(werk, 'root', 'The root card')
  realCard(werk, 'child-a', 'Child A', 'root', ['--body', 'The body of child A'])
  await page.goto(werk.url)
  await page.locator(`${card('child-a')} > a`).click()
  await expect(page).toHaveURL(/#child-a$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'child-a')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Child A')
  await expect(detail).toContainText('The body of child A')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#child-a$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'child-a')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  realCard(werk, 'root', 'The root card')
  await page.goto(werk.url)
  await expect(page.locator(card('root'))).toBeVisible()
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env: werk.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  let out = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => { second.kill('SIGKILL'); resolve(-999) }, 12_000)
    second.on('exit', (c) => { clearTimeout(t); resolve(c) })
  })
  const took = Date.now() - started
  console.log({ code, took, err, out, pid: werk.pid })
  expect(err).toContain(`waiting for pid ${werk.pid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  const after = err.split('waiting for')[1] ?? ''
  expect(after).toContain(String(werk.pid))
  await page.goto(werk.url)
  await expect(page.locator(`${card('root')} > a`)).toContainText('The root card')
})
